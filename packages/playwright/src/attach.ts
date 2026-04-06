import { randomUUID } from 'crypto'
import type { Page } from '@playwright/test'
import type { TraceEvent, IntrospectHandle, DetachResult, ScopeFrame } from '@introspection/types'
import {
  initSessionDir, appendEvent, writeAsset, summariseBody, finalizeSession,
  normaliseCdpNetworkRequest, normaliseCdpNetworkResponse, normaliseCdpJsError,
  takeSnapshot, createEvalSocket,
} from '@introspection/core'
import { createPageProxy } from './proxy.js'
import { join } from 'path'

export interface AttachOptions {
  outDir?: string
  testTitle?: string
  workerIndex?: number
}

export async function attach(page: Page, opts: AttachOptions = {}): Promise<IntrospectHandle> {
  const sessionId = randomUUID()
  const outDir = opts.outDir ?? '.introspect'
  const testTitle = opts.testTitle ?? 'unknown test'
  const startedAt = Date.now()

  await initSessionDir(outDir, { id: sessionId, startedAt, label: testTitle })

  const cdp = await page.context().newCDPSession(page)

  function ts(): number { return Date.now() - startedAt }

  function emit(event: Omit<TraceEvent, 'id' | 'ts'> & { id?: string; ts?: number }) {
    void appendEvent(outDir, sessionId, { id: randomUUID(), ts: ts(), ...event } as TraceEvent)
  }

  await cdp.send('Network.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Debugger.enable')
  await cdp.send('DOM.enable')
  await cdp.send('Debugger.setPauseOnExceptions', { state: 'uncaught' })

  let pendingSnapshot: { scopes: ScopeFrame[] } | null = null

  cdp.on('Debugger.paused', (params: {
    reason: string
    callFrames?: Array<{ functionName: string; url: string; location: { lineNumber: number }; scopeChain: Array<{ type: string; object: { objectId?: string } }> }>
  }) => {
    if (!['exception', 'promiseRejection'].includes(params.reason)) {
      void cdp.send('Debugger.resume')
      return
    }
    void (async () => {
      const scopes: ScopeFrame[] = []
      for (const frame of (params.callFrames ?? []).slice(0, 5)) {
        const locals: Record<string, unknown> = {}
        for (const scope of frame.scopeChain.slice(0, 3)) {
          if (!scope.object.objectId) continue
          try {
            const { result } = await cdp.send('Runtime.getProperties', {
              objectId: scope.object.objectId, ownProperties: true,
            }) as { result: Array<{ name: string; value?: { type?: string; value?: unknown; description?: string; objectId?: string } }> }
            for (const prop of result.slice(0, 20)) {
              const v = prop.value
              if (!v) { locals[prop.name] = undefined; continue }
              locals[prop.name] = v.value ?? v.description ?? undefined
            }
          } catch { /* non-fatal */ }
        }
        scopes.push({ frame: `${frame.functionName || '(anonymous)'} (${frame.url}:${frame.location.lineNumber + 1})`, locals })
      }
      pendingSnapshot = { scopes }
      await cdp.send('Debugger.resume')
    })()
  })

  cdp.on('Network.requestWillBeSent', (params) => {
    emit(normaliseCdpNetworkRequest(params as never, startedAt))
  })

  const pendingResponses = new Map<string, ReturnType<typeof normaliseCdpNetworkResponse>>()

  cdp.on('Network.responseReceived', (params) => {
    pendingResponses.set((params as { requestId: string }).requestId, normaliseCdpNetworkResponse(params as never, startedAt))
  })

  cdp.on('Network.loadingFinished', (params: { requestId: string }) => {
    const responseEvent = pendingResponses.get(params.requestId)
    if (!responseEvent) return
    pendingResponses.delete(params.requestId)
    void (async () => {
      try {
        const result = await cdp.send('Network.getResponseBody', { requestId: params.requestId }) as { body: string; base64Encoded: boolean }
        const body = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf-8') : result.body
        const summary = summariseBody(body)
        await writeAsset({ directory: outDir, name: sessionId, kind: 'body', content: body, metadata: { timestamp: ts(), summary } })
        await appendEvent(outDir, sessionId, { ...responseEvent, data: { ...responseEvent.data, bodySummary: summary } })
      } catch {
        await appendEvent(outDir, sessionId, responseEvent)
      }
    })()
  })

  cdp.on('Network.loadingFailed', (params: { requestId: string }) => {
    const responseEvent = pendingResponses.get(params.requestId)
    if (responseEvent) { pendingResponses.delete(params.requestId); void appendEvent(outDir, sessionId, responseEvent) }
  })

  cdp.on('Runtime.exceptionThrown', (params) => {
    void (async () => {
      const captured = pendingSnapshot
      pendingSnapshot = null
      const snap = await takeSnapshot({
        cdpSession: { send: (method: string, p?: Record<string, unknown>) => cdp.send(method as never, p as never) },
        trigger: 'js.error',
        url: await page.evaluate(() => location.href).catch(() => ''),
        callFrames: [],
      })
      const mergedSnap = captured ? { ...snap, scopes: captured.scopes } : snap
      await writeAsset({ directory: outDir, name: sessionId, kind: 'snapshot', content: JSON.stringify(mergedSnap), metadata: {
        timestamp: ts(), trigger: 'js.error', url: mergedSnap.url, scopeCount: mergedSnap.scopes.length,
      } })
      emit(normaliseCdpJsError(params as never, startedAt))
    })()
  })

  const evalSocket = createEvalSocket(
    join(outDir, sessionId, '.socket'),
    join(outDir, sessionId, 'events.ndjson'),
  )

  const proxiedPage = createPageProxy(page, (evt) => emit(evt as never))

  return {
    page: proxiedPage,
    mark(label: string, data?: Record<string, unknown>) {
      emit({ type: 'mark', source: 'agent', data: { label, extra: data } })
    },
    async snapshot() {
      const snap = await takeSnapshot({
        cdpSession: { send: (method: string, p?: Record<string, unknown>) => cdp.send(method as never, p as never) },
        trigger: 'manual',
        url: await page.evaluate(() => location.href).catch(() => ''),
      })
      await writeAsset({ directory: outDir, name: sessionId, kind: 'snapshot', content: JSON.stringify(snap), metadata: {
        timestamp: ts(), trigger: 'manual', url: snap.url, scopeCount: snap.scopes.length,
      } })
    },
    async detach(result?: DetachResult) {
      if (result) emit({ type: 'playwright.result', source: 'playwright', data: result })
      await finalizeSession(outDir, sessionId, Date.now())
      await evalSocket.shutdown()
      try { await cdp.detach() } catch { /* non-fatal */ }
    },
  }
}
