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
  let pendingSnapshot: { scopes: import('@introspection/types').ScopeFrame[] } | null = null

  // Inject session context so browser-side plugins (e.g. plugin-redux) can connect
  await page.addInitScript({
    content: `window.__INTROSPECT_SESSION_ID__="${sessionId}";window.__INTROSPECT_WS_URL__="${viteUrl}";`,
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
      const captured = pendingSnapshot
      pendingSnapshot = null
      const base = await takeSnapshot({
        cdpSession: {
          send: (method: string, params?: Record<string, unknown>) =>
            cdp.send(method as never, params as never),
        },
        trigger,
        url: await page.evaluate(() => location.href),
        callFrames: [],
        plugins: [],
      })
      // Merge pre-captured scopes (captured while debugger was still paused)
      return captured ? { ...base, scopes: captured.scopes } : base
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

  // Pause on uncaught exceptions so we can capture local scope for the snapshot.
  // We capture scope variables while paused, then resume immediately.
  await cdp.send('Debugger.setPauseOnExceptions', { state: 'uncaught' })

  cdp.on('Debugger.paused', (params: { callFrames: Array<{ functionName: string; url: string; location: { lineNumber: number }; scopeChain: Array<{ type: string; object: { objectId?: string } }> }>; reason: string }) => {
    // Capture scope for all pause reasons that look like exceptions; resume for others
    if (!['exception', 'promiseRejection'].includes(params.reason)) {
      void cdp.send('Debugger.resume')
      return
    }
    // Capture scope synchronously before resuming (objectIds become invalid after resume)
    const captureAndResume = async () => {
      const scopes: import('@introspection/types').ScopeFrame[] = []
      for (const frame of (params.callFrames ?? []).slice(0, 5)) {
        const locals: Record<string, unknown> = {}
        for (const scope of frame.scopeChain.slice(0, 3)) {
          if (!scope.object.objectId) continue
          try {
            const { result } = await cdp.send('Runtime.getProperties', {
              objectId: scope.object.objectId,
              ownProperties: true,
            }) as { result: Array<{ name: string; value?: { type?: string; value?: unknown; description?: string; objectId?: string } }> }
            for (const prop of result.slice(0, 20)) {
              const v = prop.value
              if (!v) { locals[prop.name] = undefined; continue }
              if (v.type === 'object' && v.objectId) {
                // One-level deep expansion for plain objects (skip functions, arrays)
                try {
                  const { result: nested } = await cdp.send('Runtime.getProperties', {
                    objectId: v.objectId,
                    ownProperties: true,
                  }) as { result: Array<{ name: string; value?: { value?: unknown; description?: string } }> }
                  const obj: Record<string, unknown> = {}
                  for (const np of nested.slice(0, 10)) {
                    obj[np.name] = np.value?.value ?? np.value?.description ?? undefined
                  }
                  locals[prop.name] = obj
                } catch {
                  locals[prop.name] = v.description ?? 'Object'
                }
              } else {
                locals[prop.name] = v.value ?? v.description ?? undefined
              }
            }
          } catch { /* non-fatal */ }
        }
        scopes.push({ frame: `${frame.functionName || '(anonymous)'} (${frame.url}:${frame.location.lineNumber + 1})`, locals })
      }
      pendingSnapshot = { scopes }
      await cdp.send('Debugger.resume')
    }
    void captureAndResume()
  })

  cdp.on('Network.requestWillBeSent', (params) => {
    sendEvent(normaliseCdpNetworkRequest(params as never, sessionId, startedAt))
  })
  // Pending response events keyed by CDP requestId — body is fetched on loadingFinished
  const pendingResponses = new Map<string, { event: ReturnType<typeof normaliseCdpNetworkResponse> }>()

  cdp.on('Network.responseReceived', (params) => {
    const responseEvent = normaliseCdpNetworkResponse(params as never, sessionId, startedAt)
    pendingResponses.set((params as { requestId: string }).requestId, { event: responseEvent })
  })

  cdp.on('Network.loadingFinished', (params: { requestId: string }) => {
    const pending = pendingResponses.get(params.requestId)
    if (!pending) return
    pendingResponses.delete(params.requestId)
    const { event: responseEvent } = pending
    void (async () => {
      try {
        const result = await cdp.send('Network.getResponseBody', { requestId: params.requestId }) as { body: string; base64Encoded: boolean }
        const body = result.base64Encoded
          ? Buffer.from(result.body, 'base64').toString('utf-8')
          : result.body
        await server.storeBody(sessionId, responseEvent.id, body)
      } catch {
        // Body not available for this request (e.g. redirect, stream, Playwright-mocked)
      }
      sendEvent(responseEvent)
    })()
  })

  cdp.on('Network.loadingFailed', (params: { requestId: string }) => {
    // Flush any response event that didn't get a loadingFinished (e.g. cancelled after headers)
    const pending = pendingResponses.get(params.requestId)
    if (pending) {
      pendingResponses.delete(params.requestId)
      sendEvent(pending.event)
    }
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
