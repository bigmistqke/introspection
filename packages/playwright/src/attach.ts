import { randomUUID } from 'crypto'
import type { Page } from '@playwright/test'
import type { TraceEvent, IntrospectHandle, DetachResult, IntrospectionPlugin, PluginMeta, BusPayloadMap, SessionWriter, EmitInput } from '@introspection/types'
import { createDebug } from '@introspection/utils'
import { takeSnapshot } from './snapshot.js'
import { appendEvent, writeAsset, finalizeSession, createSessionWriter } from '@introspection/write'
import { createPageProxy } from './proxy.js'
import { PluginRegistry } from './plugin-registry.js'
import { loadIntrospectConfig, resolvePlugins } from './config.js'

export interface AttachOptions {
  outDir?: string
  id?: string
  testTitle?: string
  titlePath?: string[]
  workerIndex?: number
  plugins?: IntrospectionPlugin[]
  verbose?: boolean
  session?: SessionWriter
  cwd?: string
}

export function toPluginMetas(plugins: IntrospectionPlugin[]): PluginMeta[] {
  return plugins.map(({ name, description, events, options }) => {
    const meta: PluginMeta = { name }
    if (description) meta.description = description
    if (events) meta.events = events
    if (options) meta.options = options
    return meta
  })
}

export async function attach(page: Page, options: AttachOptions = {}): Promise<IntrospectHandle> {
  const debug = createDebug('introspect', options.verbose ?? false)
  const config = (options.plugins || !options.cwd)
    ? undefined
    : await loadIntrospectConfig({ cwd: options.cwd })
  const plugins = resolvePlugins({
    optsPlugins: options.plugins,
    config,
    env: process.env,
  })
  const pluginMetas = toPluginMetas(plugins)

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
  function emit(event: EmitInput): Promise<void> {
    return session.emit({ pageId, ...event })
  }

  const { bus, timestamp } = session

  const cdp = await page.context().newCDPSession(page)

  const registry = new PluginRegistry()

  function makePluginContext(plugin: IntrospectionPlugin) {
    return {
      page,
      cdpSession: {
        // Fresh `cdp.send` lookup on every call so instrumentation plugins
        // (plugin-cdp) can monkey-patch `cdp.send` at install time and have
        // subsequent plugin-issued commands flow through the patched version.
        send: (method: string, params?: Record<string, unknown>) => cdp.send(method as Parameters<typeof cdp.send>[0], params as Parameters<typeof cdp.send>[1]),
        on: (event: string, handler: (params: unknown) => void) => cdp.on(event as Parameters<typeof cdp.on>[0], handler as Parameters<typeof cdp.on>[1]),
      },
      rawCdpSession: cdp,
      emit,
      writeAsset: session.writeAsset.bind(session),
      timestamp,
      track: (operation: () => Promise<unknown>) => session.track(operation),
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
        const event = JSON.parse(bindingCall.payload) as EmitInput
        emit(event)
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
    session.track(async () => {
      await Promise.all(
        Array.from(registry.all()).map(async ([nodeId, subscription]) => {
          try {
            const expression = `(() => { const p = window.__introspect_plugins__?.['${subscription.pluginName}']; return p ? p.watch(${JSON.stringify(subscription.spec)}) : null })()`
            const evaluationResult = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }) as { result: { value: string } }
            registry.updateBrowserId(nodeId, evaluationResult.result.value)
          } catch { /* non-fatal */ }
        })
      )
    })
  })

  // Emit page.attach event
  emit({ type: 'page.attach', metadata: { pageId } })

  if (options.titlePath) {
    emit({ type: 'playwright.test.start', metadata: { titlePath: options.titlePath } })
  }

  const proxiedPage = createPageProxy({
    emit: (event) => emit(event),
    writeAsset: async (wopts) => session.writeAsset(wopts),
    timestamp,
    page,
  })

  return {
    session,
    pageId,
    page: proxiedPage,
    emit,
    async writeAsset(opts) {
      return session.writeAsset(opts)
    },
    async mark(label: string) {
      await emit({ type: 'mark', metadata: { label } })
    },
    async snapshot() {
      await bus.emit('manual', { trigger: 'manual', timestamp: timestamp() })
    },
    async flush() {
      // CDP events flow on a separate stream from Runtime.evaluate responses, so
      // events from the page's most recent JS may still be in flight after a
      // page.evaluate returns. Doing a no-op CDP roundtrip drains the queue —
      // the response can't arrive until the prior events have been delivered.
      // Then session.flush() waits for plugin async work + the write queue.
      await cdp.send('Runtime.evaluate', { expression: '0' }).catch(() => {})
      await session.flush()
    },
    async detach(detachResult?: DetachResult) {
      debug('detach', detachResult?.status)
      if (detachResult) emit({ type: 'playwright.result', metadata: detachResult })

      // Emit page.detach event
      emit({ type: 'page.detach', metadata: { pageId } })

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
