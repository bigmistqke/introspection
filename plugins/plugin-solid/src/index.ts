// Loaded as raw text by esbuild (tsup.node.config.ts sets loader['.iife.js'] = 'text').
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import BROWSER_SCRIPT from '../dist/browser.iife.js'
import { SolidDevtoolsOptions, SolidState } from './types.js'

async function captureState(context: PluginContext): Promise<void> {
  const captureTimestamp = context.timestamp()

  const state = await context.page.evaluate(() => {
    return (
      window.__introspect_plugins__ as { solid?: { getState?(): unknown } } | undefined
    )?.solid?.getState?.() ?? null
  }) as SolidState | null

  if (!state) return

  const assets = []

  if (state.structure !== null) {
    assets.push(await context.writeAsset({
      kind: 'json',
      content: JSON.stringify(state.structure),
      ext: 'json',
    }))
  }

  if (state.dgraph !== null) {
    assets.push(await context.writeAsset({
      kind: 'json',
      content: JSON.stringify(state.dgraph),
      ext: 'json',
    }))
  }

  if (state.updates !== null) {
    assets.push(await context.writeAsset({
      kind: 'json',
      content: JSON.stringify(state.updates),
      ext: 'json',
    }))
  }

  if (assets.length > 0) {
    await context.emit({
      type: 'solid.capture' as const,
      assets,
    })
  }
}

export function solidDevtools(options?: SolidDevtoolsOptions): IntrospectionPlugin {
  return {
    name: 'solid',
    script: BROWSER_SCRIPT,

    async install(context: PluginContext): Promise<void> {
      const resolvedOptions: Required<SolidDevtoolsOptions> = {
        structureUpdates: options?.structureUpdates ?? 'stream',
        nodeUpdates: options?.nodeUpdates ?? 'off',
        dependencyGraph: options?.dependencyGraph ?? 'trigger',
      }

      // Deliver config to the browser script
      await context.page.evaluate((pluginOptions) => {
        ;(window.__introspect_plugins__ as { solid?: { configure?(config: unknown): void } } | undefined)
          ?.solid?.configure?.(pluginOptions)
      }, resolvedOptions)

      // After each navigation, addInitScript re-runs browser.ts, resetting config.
      // Re-deliver config when the debugger is detected (which happens after each navigation).
      context.cdpSession.on('Runtime.bindingCalled', (rawParameters: unknown) => {
        const parameters = rawParameters as { name: string; payload: string }
        if (parameters.name !== '__introspect_push__') return
        try {
          const { type } = JSON.parse(parameters.payload) as { type: string }
          if (type === 'solid.detected') {
            context.page.evaluate((pluginOptions) => {
              ;(window.__introspect_plugins__ as { solid?: { configure?(config: unknown): void } } | undefined)
                ?.solid?.configure?.(pluginOptions)
            }, resolvedOptions).catch(() => {
              // Navigation may destroy the execution context before configure completes — expected.
            })
          }
        } catch { /* ignore malformed push */ }
      })

      context.bus.on('manual', async () => { await captureState(context) })
      context.bus.on('js.error', async () => { await captureState(context) })
      context.bus.on('detach', async () => { await captureState(context) })
    },
  }
}
