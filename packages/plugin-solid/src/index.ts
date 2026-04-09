// Loaded as raw text by esbuild (tsup.node.config.ts sets loader['.iife.js'] = 'text').
// The import path is relative to src/ and resolved at build time — not a runtime path.
import BROWSER_SCRIPT from '../dist/browser.iife.js'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
// Side-effect import: brings the 'js.error' BusPayloadMap augmentation into scope
import '@introspection/plugin-js-errors'

declare global {
  interface Window {
    __introspect_plugins__?: Record<string, unknown>
  }
}

export type SolidCaptureMode = 'stream' | 'trigger' | 'off'

export interface SolidDevtoolsOptions {
  structureUpdates?: SolidCaptureMode  // default: 'stream'
  nodeUpdates?: SolidCaptureMode       // default: 'off'
  dependencyGraph?: SolidCaptureMode   // default: 'trigger'
}

interface SolidState {
  structure: unknown | null
  updates: unknown | null
  dgraph: unknown | null
}

async function captureState(context: PluginContext): Promise<void> {
  const captureTimestamp = context.timestamp()

  const state = await context.page.evaluate(() => {
    return (window.__introspect_plugins__ as { solid?: { getState?(): unknown } } | undefined)
      ?.solid?.getState?.() ?? null
  }) as SolidState | null

  if (!state) return

  if (state.structure !== null) {
    await context.writeAsset({
      kind: 'solid-structure',
      content: JSON.stringify(state.structure),
      metadata: { timestamp: captureTimestamp },
    })
  }

  if (state.dgraph !== null) {
    await context.writeAsset({
      kind: 'solid-dgraph',
      content: JSON.stringify(state.dgraph),
      metadata: { timestamp: captureTimestamp },
    })
  }

  if (state.updates !== null) {
    await context.writeAsset({
      kind: 'solid-updates',
      content: JSON.stringify(state.updates),
      metadata: { timestamp: captureTimestamp },
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

      await context.page.evaluate((pluginOptions) => {
        ;(window.__introspect_plugins__ as { solid?: { configure?(config: unknown): void } } | undefined)
          ?.solid?.configure?.(pluginOptions)
      }, resolvedOptions)

      context.bus.on('manual', async () => { await captureState(context) })
      context.bus.on('js.error', async () => { await captureState(context) })
      context.bus.on('detach', async () => { await captureState(context) })
    },
  }
}
