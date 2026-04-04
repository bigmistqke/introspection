import { randomUUID } from 'crypto'
// @ts-expect-error Missing ws type declarations
import WebSocket from 'ws'
import { rpc, expose } from '@bigmistqke/rpc/websocket'
import type { Page } from '@playwright/test'
import type {
  IntrospectHandle, TraceEvent,
  IntrospectionServerMethods, PlaywrightClientMethods,
  DetachResult,
} from '@introspection/types'
import { createPageProxy } from './proxy.js'
import { normaliseCdpNetworkRequest, normaliseCdpNetworkResponse, normaliseCdpJsError } from './cdp.js'
// @ts-expect-error Cannot resolve path to vite snapshot
import { takeSnapshot } from '@introspection/vite/snapshot'

export interface AttachOptions {
  viteUrl: string       // ws://localhost:<port>/__introspection
  sessionId: string
  testTitle: string
  testFile: string
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
  const outDir = opts?.outDir ?? '.introspect'
  const workerIndex = opts?.workerIndex ?? 0
  const startedAt = Date.now()
  let currentUrl = ''

  // Inject session context so browser-side plugins (e.g. plugin-redux) can connect
  await page.addInitScript({
    content: `window.__INTROSPECT_SESSION_ID__="${sessionId}";window.__INTROSPECT_URL__="${viteUrl}";`,
  })

  const ws = new WebSocket(viteUrl)
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const cleanup = () => clearTimeout(timer)
    ws.once('open', () => { cleanup(); resolve() })
    ws.once('error', (err: any) => { cleanup(); reject(err) })
    timer = setTimeout(
      () => reject(new Error(`Could not connect to Vite introspection server at ${viteUrl}`)),
      3000,
    )
  })

  const server = rpc<IntrospectionServerMethods>(ws)

  const cdp = await page.context().newCDPSession(page)

  expose<PlaywrightClientMethods>({
    async takeSnapshot(trigger) {
      return takeSnapshot({
        cdpSession: {
          send: (method: string, params?: Record<string, unknown>) =>
            cdp.send(method as never, params as never),
        },
        trigger,
        url: await page.evaluate(() => location.href),
        callFrames: [],
        plugins: [],
      })
    },
  }, { to: ws })

  await server.startSession({ id: sessionId, startedAt, label: testTitle })

  /** Fire-and-forget — CDP event handlers are synchronous and cannot await. */
  function sendEvent(event: Omit<TraceEvent, 'id' | 'ts'> & { id?: string; ts?: number }) {
    if (ws.readyState !== 1 /* WebSocket.OPEN */) return
    void server.event(sessionId, { id: randomUUID(), ts: Date.now() - startedAt, ...event } as TraceEvent)
  }

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
    void server.requestSnapshot(sessionId, 'js.error')
  })
  cdp.on('Page.navigatedWithinDocument', (params: { url: string }) => {
    sendEvent({ type: 'browser.navigate', source: 'cdp', data: { from: currentUrl, to: params.url } })
    currentUrl = params.url
  })

  const proxiedPage = createPageProxy(page, (evt) => sendEvent(evt as never))

  const handle: IntrospectHandle = {
    page: proxiedPage,
    mark(label, data) {
      sendEvent({ type: 'mark', source: 'agent', data: { label, extra: data } })
    },
    async snapshot() {
      await server.requestSnapshot(sessionId, 'manual')
    },
    async detach(result?: DetachResult) {
      if (result) {
        sendEvent({ type: 'playwright.result', source: 'playwright', data: result })
      }
      await server.endSession(sessionId, outDir, workerIndex)
      try { await cdp.detach() } catch { /* non-fatal: browser context may already be closed */ }
      await new Promise<void>((resolve) => {
        ws.once('close', resolve)
        ws.close()
      })
    },
  }

  return handle
}
