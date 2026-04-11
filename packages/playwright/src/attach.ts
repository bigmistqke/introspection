import { randomUUID } from 'crypto'
import type { Page } from '@playwright/test'
import type { TraceEvent, IntrospectHandle, DetachResult, IntrospectionPlugin, PluginMeta, BusPayloadMap, SessionWriter, EmitInput } from '@introspection/types'
import { createDebug } from '@introspection/utils'
import { takeSnapshot } from './snapshot.js'
import { appendEvent, writeAsset, finalizeSession, createSessionWriter } from '@introspection/write'
import { createPageProxy } from './proxy.js'
import { PluginRegistry } from './plugin-registry.js'

export interface AttachOptions {
  outDir?: string
  id?: string
  testTitle?: string
  titlePath?: string[]
  workerIndex?: number
  plugins?: IntrospectionPlugin[]
  verbose?: boolean
  session?: SessionWriter
}

export async function attach(page: Page, options: AttachOptions = {}): Promise<IntrospectHandle> {
  const debug = createDebug('introspect', options.verbose ?? false)
  const plugins = options.plugins ?? []
  const pluginMetas: PluginMeta[] = plugins
    .map(({ name, description, events, options }) => {
      const meta: PluginMeta = { name }
      if (description) meta.description = description
      if (events) meta.events = events
      if (options) meta.options = options
      return meta
    })

  // Use provided session or create an implicit one
  const ownsSession = !options.session
  const session = options.session ?? await createSessionWriter({
    id: options.id,
    outDir: options.outDir,
    label: options.testTitle,
    plugins: pluginMetas.length > 0 ? pluginMetas : undefined,
  })

  const pageId = randomUUID().replace(/-/g, '').slice(0, 8)

  debug('attach', { sessionId: session.id, pageId, testTitle: options.testTitle })

  // Wrap session.emit to stamp pageId onto every event from this page
  function emit(event: EmitInput) {
    session.emit({ pageId, ...event })
  }

  const { bus, timestamp } = session

  const cdp = await page.context().newCDPSession(page)
  const cdpSend = cdp.send.bind(cdp) as (method: string, params?: Record<string, unknown>) => Promise<unknown>

  const registry = new PluginRegistry()

  function makePluginContext(plugin: IntrospectionPlugin) {
    return {
      page,
      cdpSession: {
        send: (method: string, params?: Record<string, unknown>) => cdpSend(method, params),
        on: (event: string, handler: (params: unknown) => void) => cdp.on(event as Parameters<typeof cdp.on>[0], handler as Parameters<typeof cdp.on>[1]),
      },
      emit,
      async writeAsset(wopts: { kind: string; content: string | Buffer; ext?: string; metadata: { timestamp: number; [key: string]: unknown }; source?: string }) {
        return session.writeAsset({
          kind: wopts.kind, content: wopts.content, ext: wopts.ext,
          metadata: wopts.metadata, source: (wopts.source ?? 'plugin') as TraceEvent['source'],
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
        emit({ type, source: 'plugin', data } as unknown as EmitInput)
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

  // Emit page.attach event
  emit({ type: 'page.attach', source: 'playwright', data: { pageId } })

  if (options.titlePath) {
    emit({ type: 'playwright.test.start', source: 'playwright', data: { titlePath: options.titlePath } })
  }

  const proxiedPage = createPageProxy({
    emit: (event) => emit(event),
    writeAsset: async (wopts) => session.writeAsset({
      kind: wopts.kind, content: wopts.content, ext: wopts.ext,
      metadata: wopts.metadata, source: (wopts.source ?? 'playwright') as TraceEvent['source'],
    }),
    timestamp,
    page,
  })

  return {
    session,
    pageId,
    page: proxiedPage,
    mark(label: string, data?: Record<string, unknown>) {
      emit({ type: 'mark', source: 'agent', data: { label, extra: data } })
    },
    emit,
    async writeAsset(opts) {
      return session.writeAsset({
        kind: opts.kind, content: opts.content, ext: opts.ext,
        metadata: opts.metadata, source: opts.source ?? 'agent',
      })
    },
    async snapshot() {
      const snap = await takeSnapshot({
        cdpSession: { send: cdpSend },
        trigger: 'manual',
        url: await page.evaluate(() => location.href).catch(() => ''),
      })
      await session.writeAsset({
        kind: 'snapshot',
        content: JSON.stringify(snap),
        metadata: { timestamp: timestamp(), trigger: 'manual', url: snap.url, scopeCount: snap.scopes.length },
      })
      await bus.emit('manual', { trigger: 'manual', timestamp: timestamp() })
    },
    async detach(detachResult?: DetachResult) {
      debug('detach', detachResult?.status)
      if (detachResult) emit({ type: 'playwright.result', source: 'playwright', data: detachResult })

      // Emit page.detach event
      emit({ type: 'page.detach', source: 'playwright', data: { pageId } })

      // Bulk unwatch
      for (const [, subscription] of registry.all()) {
        const expression = `(() => { window.__introspect_plugins__?.['${subscription.pluginName}']?.unwatch(${JSON.stringify(subscription.browserId)}) })()`
        await cdp.send('Runtime.evaluate', { expression }).catch(() => {})
      }

      try { await cdp.detach() } catch { /* non-fatal */ }

      // Only finalize if we own the session (implicit session, not shared)
      if (ownsSession) {
        await session.finalize()
      }
    },
  }
}
