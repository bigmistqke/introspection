import { randomUUID } from 'crypto'
// @ts-expect-error Missing ws type declarations
import WebSocket from 'ws'
import type { Page } from '@playwright/test'
import type { IntrospectHandle, TraceEvent, OnErrorSnapshot, TestResult } from '@introspection/types'
import { createPageProxy } from './proxy.js'
import { normaliseCdpNetworkRequest, normaliseCdpNetworkResponse, normaliseCdpJsError } from './cdp.js'
// @ts-expect-error Cannot resolve path to vite snapshot
import { takeSnapshot } from '@introspection/vite/snapshot'

export interface AttachOptions {
  viteUrl: string       // ws://localhost:<port>/__introspection
  sessionId: string
  testTitle: string
  testFile: string
  // workerIndex and outDir are reserved for future server-side trace routing
  workerIndex: number
  outDir: string
}

function getViteUrl(): string {
  const port = process.env.VITE_PORT ?? '5173'
  return `ws://localhost:${port}/__introspection`
}

export async function attach(page: Page, opts?: Partial<AttachOptions>): Promise<IntrospectHandle> {
  const sessionId = opts?.sessionId ?? randomUUID()
  const viteUrl = opts?.viteUrl ?? getViteUrl()
  const testTitle = opts?.testTitle ?? 'unknown test'
  const testFile = opts?.testFile ?? 'unknown file'
  const startedAt = Date.now()

  // Connect to Vite plugin WS
  const ws = new WebSocket(viteUrl)
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const cleanup = () => clearTimeout(timer)
    ws.once('open', () => { cleanup(); resolve() })
    ws.once('error', (err: any) => { cleanup(); reject(err) })
    timer = setTimeout(() => reject(new Error(`Could not connect to Vite introspection server at ${viteUrl}`)), 3000)
  })

  function sendEvent(event: Omit<TraceEvent, 'id' | 'ts'> & { id?: string; ts?: number }) {
    if (ws.readyState !== 1 /* WebSocket.OPEN */) return
    ws.send(JSON.stringify({ type: 'EVENT', sessionId, event: { id: randomUUID(), ts: Date.now() - startedAt, ...event } }))
  }

  // Start session
  ws.send(JSON.stringify({ type: 'START_SESSION', sessionId, testTitle, testFile }))

  // Open CDP session
  const cdp = await page.context().newCDPSession(page)

  // Handle incoming messages from Vite server
  ws.on('message', async (raw: any) => {
    let msg: Record<string, unknown>
    try { msg = JSON.parse(raw.toString()) } catch { return }

    if (msg.type === 'TAKE_SNAPSHOT') {
      const snapshot = await takeSnapshot({
        cdpSession: { send: (method: string, params?: Record<string, unknown>) => cdp.send(method as never, params as never) },
        trigger: (msg.trigger as OnErrorSnapshot['trigger']) ?? 'manual',
        url: await page.evaluate(() => location.href),
        callFrames: [],
        plugins: [],
      })
      ws.send(JSON.stringify({ type: 'SNAPSHOT', sessionId, snapshot }))
    }
  })

  await cdp.send('Network.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Debugger.enable')
  await cdp.send('DOM.enable')
  await cdp.send('Page.enable')

  cdp.on('Network.requestWillBeSent', (params) => {
    sendEvent(normaliseCdpNetworkRequest(params as never, sessionId, startedAt))
  })
  cdp.on('Network.responseReceived', (params) => {
    sendEvent(normaliseCdpNetworkResponse(params as never, sessionId, startedAt))
  })
  cdp.on('Runtime.exceptionThrown', (params) => {
    sendEvent(normaliseCdpJsError(params as never, sessionId, startedAt))
  })
  cdp.on('Page.navigatedWithinDocument', (params: { url: string }) => {
    // CDP does not provide the previous URL in this event; 'from' is always empty
    sendEvent({ type: 'browser.navigate', source: 'cdp', data: { from: '', to: params.url } })
  })

  // Proxy page for playwright.action tracking
  const proxiedPage = createPageProxy(page, (evt) => sendEvent(evt as never))

  const handle: IntrospectHandle = {
    page: proxiedPage,
    mark(label, data) {
      sendEvent({ type: 'mark', source: 'agent', data: { label, extra: data } })
    },
    async snapshot() {
      ws.send(JSON.stringify({ type: 'SNAPSHOT_REQUEST', sessionId, trigger: 'manual' }))
    },
    async detach(result?: TestResult) {
      ws.send(JSON.stringify({ type: 'END_SESSION', sessionId, result: result ?? { status: 'passed', duration: 0 } }))
      try { await cdp.detach() } catch { /* non-fatal: browser context may already be closed */ }
      await new Promise<void>((resolve) => {
        ws.once('close', resolve)
        ws.close()
      })
    },
  }

  return handle
}
