import { randomUUID } from 'crypto'
import type { Page } from '@playwright/test'
import type { TraceEvent, IntrospectHandle, DetachResult, ScopeFrame, IntrospectionPlugin, PluginContext } from '@introspection/types'
import {
  initSessionDir, appendEvent, writeAsset, summariseBody, finalizeSession,
  normaliseCdpNetworkRequest, normaliseCdpNetworkResponse, normaliseCdpJsError,
  takeSnapshot,
} from '@introspection/core'
import { createPageProxy } from './proxy.js'
import { PluginRegistry } from './plugin-registry.js'
import { createDebug } from './debug.js'

export interface AttachOptions {
  outDir?: string
  testTitle?: string
  workerIndex?: number
  plugins?: IntrospectionPlugin[]
  verbose?: boolean
}

export async function attach(page: Page, opts: AttachOptions = {}): Promise<IntrospectHandle> {
  const sessionId = randomUUID()
  const outDir = opts.outDir ?? '.introspect'
  const testTitle = opts.testTitle ?? 'unknown test'
  const startedAt = Date.now()
  const debug = createDebug('introspect', opts.verbose ?? false)

  debug('attach', { sessionId, testTitle, outDir })
  await initSessionDir(outDir, { id: sessionId, startedAt, label: testTitle })

  const cdp = await page.context().newCDPSession(page)
  // Untyped wrapper for generic CDP calls where the method is a runtime string
  const cdpSend = cdp.send.bind(cdp) as (method: string, params?: Record<string, unknown>) => Promise<unknown>

  function timestamp(): number { return Date.now() - startedAt }

  function emit(event: Omit<TraceEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: number }) {
    void appendEvent(outDir, sessionId, { id: randomUUID(), timestamp: timestamp(), ...event } as TraceEvent)
  }

  const plugins = opts.plugins ?? []
  const registry = new PluginRegistry()

  function makePluginCtx(plugin: IntrospectionPlugin): PluginContext {
    return {
      page,
      cdpSession: { send: (method, params) => cdpSend(method, params) },
      emit,
      async writeAsset(wopts) {
        return writeAsset({
          directory: outDir, name: sessionId,
          kind: wopts.kind, content: wopts.content, ext: wopts.ext,
          metadata: wopts.metadata, source: wopts.source ?? 'plugin',
        })
      },
      timestamp,
      async addSubscription(pluginName: string, spec: unknown) {
        const expr = `(() => { const p = window.__introspect_plugins__?.['${pluginName}']; return p ? p.watch(${JSON.stringify(spec)}) : null })()`
        const result = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }) as { result: { value: string } }
        const browserId = result.result.value
        const nodeId = registry.add(pluginName, spec, browserId)
        return {
          async unwatch() {
            const sub = registry.remove(nodeId)
            if (!sub) return
            const unwatchExpr = `(() => { window.__introspect_plugins__?.['${sub.pluginName}']?.unwatch(${JSON.stringify(sub.browserId)}) })()`
            await cdp.send('Runtime.evaluate', { expression: unwatchExpr }).catch(() => {})
          },
        }
      },
    }
  }

  await cdp.send('Network.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Debugger.enable')
  await cdp.send('DOM.enable')
  await cdp.send('Page.enable')
  await cdp.send('Debugger.setPauseOnExceptions', { state: 'uncaught' })

  // Push bridge — browser calls window.__introspect_push__(JSON.stringify({type, data}))
  if (plugins.length > 0) {
    await cdp.send('Runtime.addBinding', { name: '__introspect_push__' })
    cdp.on('Runtime.bindingCalled', (params: { name: string; payload: string }) => {
      if (params.name !== '__introspect_push__') return
      try {
        const { type, data } = JSON.parse(params.payload) as { type: string; data: Record<string, unknown> }
        emit({ type, source: 'plugin', data } as unknown as Parameters<typeof emit>[0])
      } catch { /* malformed push — ignore */ }
    })
  }

  // Inject scripts (future navigations) + evaluate immediately (current page)
  for (const plugin of plugins) {
    debug('installing plugin', plugin.name)
    await page.addInitScript({ content: plugin.script })
    await page.evaluate((script: string) => { new Function(script)() }, plugin.script).catch(() => {})
    await plugin.install(makePluginCtx(plugin))
  }

  // Re-apply subscriptions after each navigation
  page.on('load', () => {
    void (async () => {
      for (const [nodeId, sub] of registry.all()) {
        try {
          const expr = `(() => { const p = window.__introspect_plugins__?.['${sub.pluginName}']; return p ? p.watch(${JSON.stringify(sub.spec)}) : null })()`
          const result = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }) as { result: { value: string } }
          registry.updateBrowserId(nodeId, result.result.value)
        } catch { /* non-fatal */ }
      }
    })()
  })

  // Tracks in-flight async handlers (e.g. error processing). detach() drains these
  // before finalizing so no events are lost to a race with cleanup.
  const pending = new Set<Promise<void>>()
  function track(promise: Promise<void>): void { pending.add(promise); void promise.finally(() => pending.delete(promise)) }

  cdp.on('Debugger.paused', (params: {
    reason: string
    data?: Record<string, unknown>
    callFrames?: Array<{ functionName: string; url: string; location: { lineNumber: number; columnNumber?: number }; scopeChain: Array<{ type: string; object: { objectId?: string } }> }>
  }) => {
    if (!['exception', 'promiseRejection'].includes(params.reason)) {
      void cdp.send('Debugger.resume').catch(() => {})
      return
    }
    debug('Debugger.paused', params.reason, (params.callFrames?.[0]?.url ?? ''))
    track((async () => {
      // Collect scope locals while the debugger is still paused
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
              const propValue = prop.value
              if (!propValue) { locals[prop.name] = undefined; continue }
              locals[prop.name] = propValue.value ?? propValue.description ?? undefined
            }
          } catch { /* non-fatal */ }
        }
        scopes.push({ frame: `${frame.functionName || '(anonymous)'} (${frame.url}:${frame.location.lineNumber + 1})`, locals })
      }

      // Resume before any page.evaluate / CDP evaluate calls
      await cdp.send('Debugger.resume').catch(() => {})

      // Build a synthetic exceptionDetails compatible with normaliseCdpJsError
      const syntheticParams = {
        timestamp: Date.now() / 1000,
        exceptionDetails: {
          text: '',
          exception: params.data ?? {},
          stackTrace: {
            callFrames: (params.callFrames ?? []).map(frame => ({
              functionName: frame.functionName,
              url: frame.url,
              lineNumber: frame.location.lineNumber,
              columnNumber: frame.location.columnNumber ?? 0,
            })),
          },
        },
      }

      const errorEvent = normaliseCdpJsError(syntheticParams as Record<string, unknown>, startedAt)
      debug('js.error', errorEvent.data.message)
      await appendEvent(outDir, sessionId, errorEvent)

      const url = await cdp.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true })
        .then((r) => ((r as { result: { value?: string } }).result.value ?? ''))
        .catch(() => '')
      const snap = await takeSnapshot({
        cdpSession: { send: cdpSend },
        trigger: 'js.error',
        url,
        callFrames: [],
      })
      const mergedSnap = { ...snap, scopes }
      await writeAsset({ directory: outDir, name: sessionId, kind: 'snapshot', content: JSON.stringify(mergedSnap), metadata: {
        timestamp: timestamp(), trigger: 'js.error', url: mergedSnap.url, scopeCount: mergedSnap.scopes.length,
      } })

      for (const plugin of plugins) {
        if (!plugin.capture) continue
        try {
          for (const r of await plugin.capture('js.error', timestamp()))
            await writeAsset({ directory: outDir, name: sessionId, kind: r.kind, content: r.content, ext: r.ext, metadata: { timestamp: timestamp(), ...r.summary }, source: 'plugin' })
        } catch { /* non-fatal */ }
      }
    })())
  })

  // Offset to convert CDP monotonic timestamps (seconds since Chrome start) to wall-clock ms.
  // Computed from the first request's wallTime field and stored for use with response timestamps.
  let cdpTimeOffset = 0

  cdp.on('Network.requestWillBeSent', (params) => {
    const p = params as { wallTime?: number; timestamp?: number }
    if (cdpTimeOffset === 0 && typeof p.wallTime === 'number' && typeof p.timestamp === 'number') {
      cdpTimeOffset = Math.round(p.wallTime * 1000 - p.timestamp * 1000)
    }
    const event = normaliseCdpNetworkRequest(params as Record<string, unknown>, startedAt)
    debug('network.request', event.data.method, event.data.url)
    emit(event)
  })

  const pendingResponses = new Map<string, ReturnType<typeof normaliseCdpNetworkResponse>>()

  cdp.on('Network.responseReceived', (params) => {
    pendingResponses.set((params as { requestId: string }).requestId, normaliseCdpNetworkResponse(params as Record<string, unknown>, startedAt, cdpTimeOffset))
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
        await writeAsset({ directory: outDir, name: sessionId, kind: 'body', id: responseEvent.id, content: body, metadata: { timestamp: timestamp(), summary } })
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

  const proxiedPage = createPageProxy(page, (event) => emit(event))

  return {
    page: proxiedPage,
    mark(label: string, data?: Record<string, unknown>) {
      emit({ type: 'mark', source: 'agent', data: { label, extra: data } })
    },
    async snapshot() {
      const snap = await takeSnapshot({
        cdpSession: { send: cdpSend },
        trigger: 'manual',
        url: await page.evaluate(() => location.href).catch(() => ''),
      })
      await writeAsset({ directory: outDir, name: sessionId, kind: 'snapshot', content: JSON.stringify(snap), metadata: {
        timestamp: timestamp(), trigger: 'manual', url: snap.url, scopeCount: snap.scopes.length,
      } })
      for (const plugin of plugins) {
        if (!plugin.capture) continue
        try {
          for (const r of await plugin.capture('manual', timestamp()))
            await writeAsset({ directory: outDir, name: sessionId, kind: r.kind, content: r.content, ext: r.ext, metadata: { timestamp: timestamp(), ...r.summary }, source: 'plugin' })
        } catch { /* non-fatal */ }
      }
    },
    async detach(result?: DetachResult) {
      debug('detach', result?.status)
      if (result) emit({ type: 'playwright.result', source: 'playwright', data: result })

      // Drain any in-flight async handlers (e.g. error processing from Debugger.paused)
      if (pending.size > 0) {
        debug('draining', pending.size, 'pending task(s)')
        await Promise.allSettled([...pending])
        debug('drain complete')
      }

      // Bulk unwatch
      for (const [, sub] of registry.all()) {
        const expr = `(() => { window.__introspect_plugins__?.['${sub.pluginName}']?.unwatch(${JSON.stringify(sub.browserId)}) })()`
        await cdp.send('Runtime.evaluate', { expression: expr }).catch(() => {})
      }

      // Capture detach state
      for (const plugin of plugins) {
        if (!plugin.capture) continue
        try {
          for (const r of await plugin.capture('detach', timestamp()))
            await writeAsset({ directory: outDir, name: sessionId, kind: r.kind, content: r.content, ext: r.ext, metadata: { timestamp: timestamp(), ...r.summary }, source: 'plugin' })
        } catch { /* non-fatal */ }
      }

      await finalizeSession(outDir, sessionId, Date.now())
      try { await cdp.detach() } catch { /* non-fatal */ }
    },
  }
}
