// Loaded as raw text by esbuild (tsup.node.config.ts sets loader['.iife.js'] = 'text').
import type { IntrospectionPlugin, PayloadRef, PluginContext } from '@introspection/types'
import { createDebug } from '@introspection/utils'
import BROWSER_SCRIPT from '../dist/browser.iife.js'
import { SolidDevtoolsOptions, SolidState } from './types.js'

async function captureState(context: PluginContext): Promise<void> {
  const captureTimestamp = context.timestamp()

  const state = await context.page.evaluate(() => {
    return (
      window.__introspect_plugins__ as { 'solid-devtools'?: { getState?(): unknown } } | undefined
    )?.['solid-devtools']?.getState?.() ?? null
  }) as SolidState | null

  if (!state) return

  const payloads: Record<string, PayloadRef> = {}

  if (state.structure !== null) {
    payloads.structure = await context.writeAsset({
      format: 'json',
      content: JSON.stringify(state.structure),
      ext: 'json',
    })
  }

  if (state.dgraph !== null) {
    payloads.dgraph = await context.writeAsset({
      format: 'json',
      content: JSON.stringify(state.dgraph),
      ext: 'json',
    })
  }

  if (state.updates !== null) {
    payloads.updates = await context.writeAsset({
      format: 'json',
      content: JSON.stringify(state.updates),
      ext: 'json',
    })
  }

  if (Object.keys(payloads).length > 0) {
    await context.emit({
      type: 'solid-devtools.capture' as const,
      payloads,
    })
  }
}

export function solidDevtools(options?: SolidDevtoolsOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-solid-devtools', options?.verbose ?? false)
  return {
    name: 'solid-devtools',
    script: BROWSER_SCRIPT,

    async install(context: PluginContext): Promise<void> {
      const resolvedOptions = {
        structureUpdates: options?.structureUpdates ?? 'stream',
        nodeUpdates: options?.nodeUpdates ?? 'off',
        dependencyGraph: options?.dependencyGraph ?? 'trigger',
      }
      debug('installing', { ...resolvedOptions })

      // Deliver config to the browser script
      await context.page.evaluate((pluginOptions) => {
        ;(window.__introspect_plugins__ as { 'solid-devtools'?: { configure?(config: unknown): void } } | undefined)
          ?.['solid-devtools']?.configure?.(pluginOptions)
      }, resolvedOptions)

      // After each navigation, addInitScript re-runs browser.ts, resetting config.
      // Re-deliver config when the debugger is detected (which happens after each navigation).
      context.cdpSession.on('Runtime.bindingCalled', (rawParameters: unknown) => {
        const parameters = rawParameters as { name: string; payload: string }
        if (parameters.name !== '__introspect_push__') return
        try {
          const { type } = JSON.parse(parameters.payload) as { type: string }
          if (type === 'solid-devtools.detected') {
            debug('solid detected')
            context.page.evaluate((pluginOptions) => {
              ;(window.__introspect_plugins__ as { 'solid-devtools'?: { configure?(config: unknown): void } } | undefined)
                ?.['solid-devtools']?.configure?.(pluginOptions)
            }, resolvedOptions).catch(() => {
              // Navigation may destroy the execution context before configure completes — expected.
            })
          }
        } catch { /* ignore malformed push */ }
      })

      context.bus.on('manual', async () => {
        debug('capture triggered: manual')
        await captureState(context)
      })
      context.bus.on('js.error', async () => {
        debug('capture triggered: js.error')
        await captureState(context)
      })
      context.bus.on('detach', async () => {
        debug('capture triggered: detach')
        await captureState(context)
      })
    },
  }
}
