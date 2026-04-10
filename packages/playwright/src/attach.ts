import { randomUUID } from 'crypto'
import type { Page } from '@playwright/test'
import type { TraceEvent, IntrospectHandle, DetachResult, IntrospectionPlugin, PluginContext, PluginMeta, BusPayloadMap } from '@introspection/types'
import {
  initSessionDir, appendEvent, writeAsset, finalizeSession, takeSnapshot, createBus, createDebug,
} from '@introspection/core'
import { createPageProxy } from './proxy.js'
import { PluginRegistry } from './plugin-registry.js'

export interface AttachOptions {
  outDir?: string
  testTitle?: string
  workerIndex?: number
  plugins?: IntrospectionPlugin[]
  verbose?: boolean
}

export async function attach(page: Page, opts: AttachOptions): Promise<IntrospectHandle> {
  const sessionId = randomUUID()
  const outDir = opts.outDir ?? '.introspect'
  const testTitle = opts.testTitle ?? 'unknown test'
  const startedAt = Date.now()
  const debug = createDebug('introspect', opts.verbose ?? false)

  debug('attach', { sessionId, testTitle, outDir })
  const plugins = opts.plugins ?? []
  const pluginMetas: PluginMeta[] = plugins
    .map(({ name, description, events, options }) => {
      const meta: PluginMeta = { name }
      if (description) meta.description = description
      if (events) meta.events = events
      if (options) meta.options = options
      return meta
    })
  await initSessionDir(outDir, { id: sessionId, startedAt, label: testTitle, plugins: pluginMetas.length > 0 ? pluginMetas : undefined })

  const cdp = await page.context().newCDPSession(page)
  const cdpSend = cdp.send.bind(cdp) as (method: string, params?: Record<string, unknown>) => Promise<unknown>

  function timestamp(): number { return Date.now() - startedAt }

  function emit(event: Omit<TraceEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: number }) {
    const full = { id: randomUUID(), timestamp: timestamp(), ...event } as TraceEvent
    void appendEvent(outDir, sessionId, full)
    void bus.emit(full.type, full as BusPayloadMap[typeof full.type])
  }

  const bus = createBus()
  const registry = new PluginRegistry()

  function makePluginContext(plugin: IntrospectionPlugin): PluginContext {
    return {
      page,
      cdpSession: {
        send: (method, params) => cdpSend(method, params),
        on: (event, handler) => cdp.on(event as Parameters<typeof cdp.on>[0], handler as Parameters<typeof cdp.on>[1]),
      },
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
        const expression = `(() => { const p = window.__introspect_plugins__?.['${pluginName}']; return p ? p.watch(${JSON.stringify(spec)}) : null })()`
        const evaluationResult = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }) as { result: { value: string } }
        const browserId = evaluationResult.result.value
        const nodeId = registry.add(pluginName, spec, browserId)
        return {
          async unwatch() {
            const subscription = registry.remove(nodeId)
            if (!subscription) return
            const unwatchExpression = `(() => { window.__introspect_plugins__?.['${subscription.pluginName}']?.unwatch(${JSON.stringify(subscription.browserId)}) })()`
            await cdp.send('Runtime.evaluate', { expression: unwatchExpression }).catch(() => {})
          },
        }
      },
      bus,
    }
  }

  await cdp.send('Runtime.enable')
  await cdp.send('DOM.enable')
  await cdp.send('Page.enable')

  // Push bridge — browser calls window.__introspect_push__(JSON.stringify({type, data}))
  if (plugins.length > 0) {
    await cdp.send('Runtime.addBinding', { name: '__introspect_push__' })
    cdp.on('Runtime.bindingCalled', (bindingCall: { name: string; payload: string }) => {
      if (bindingCall.name !== '__introspect_push__') return
      try {
        const { type, data } = JSON.parse(bindingCall.payload) as { type: string; data: Record<string, unknown> }
        emit({ type, source: 'plugin', data } as unknown as Parameters<typeof emit>[0])
      } catch { /* malformed push — ignore */ }
    })
  }

  // Inject scripts (future navigations) + evaluate immediately (current page)
  for (const plugin of plugins) {
    debug('installing plugin', plugin.name)
    if (plugin.script) {
      await page.addInitScript({ content: plugin.script })
      await page.evaluate((script: string) => { new Function(script)() }, plugin.script).catch(() => {})
    }
    await plugin.install(makePluginContext(plugin))
  }

  // Re-apply subscriptions after each navigation
  page.on('load', () => {
    void (async () => {
      for (const [nodeId, subscription] of registry.all()) {
        try {
          const expression = `(() => { const p = window.__introspect_plugins__?.['${subscription.pluginName}']; return p ? p.watch(${JSON.stringify(subscription.spec)}) : null })()`
          const evaluationResult = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }) as { result: { value: string } }
          registry.updateBrowserId(nodeId, evaluationResult.result.value)
        } catch { /* non-fatal */ }
      }
    })()
  })

  const proxiedPage = createPageProxy({
    emit: (event) => emit(event),
    writeAsset: async (options) => writeAsset({
      directory: outDir, name: sessionId,
      kind: options.kind, content: options.content, ext: options.ext,
      metadata: options.metadata, source: options.source ?? 'playwright',
    }),
    timestamp,
    page,
  })

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
      await writeAsset({
        directory: outDir, name: sessionId, kind: 'snapshot',
        content: JSON.stringify(snap),
        metadata: { timestamp: timestamp(), trigger: 'manual', url: snap.url, scopeCount: snap.scopes.length },
      })
      await bus.emit('manual', { trigger: 'manual', timestamp: timestamp() })
    },
    async detach(detachResult?: DetachResult) {
      debug('detach', detachResult?.status)
      if (detachResult) emit({ type: 'playwright.result', source: 'playwright', data: detachResult })

      // Emit 'detach' — bus.emit() awaits all handlers (replaces the previous pending Set drain)
      await bus.emit('detach', { trigger: 'detach', timestamp: timestamp() })

      // Bulk unwatch
      for (const [, subscription] of registry.all()) {
        const expression = `(() => { window.__introspect_plugins__?.['${subscription.pluginName}']?.unwatch(${JSON.stringify(subscription.browserId)}) })()`
        await cdp.send('Runtime.evaluate', { expression }).catch(() => {})
      }

      await finalizeSession(outDir, sessionId, Date.now())
      try { await cdp.detach() } catch { /* non-fatal */ }
    },
  }
}
