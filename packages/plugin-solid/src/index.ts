// Loaded as raw text by esbuild (tsup.node.config.ts sets loader['.iife.js'] = 'text').
// The import path is relative to src/ and resolved at build time — not a runtime path.
import BROWSER_SCRIPT from '../dist/browser.iife.js'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
// Side-effect import: brings the 'js.error' BusPayloadMap augmentation into scope
import '@introspection/plugin-js-error'

// Re-export types from @solid-devtools/debugger for consumers parsing trace data
export type { NodeID, NodeType } from '@solid-devtools/debugger/types'
export type { StructureUpdates } from '@solid-devtools/debugger/types'
export type { DGraphUpdate, SerializedDGraph } from '@solid-devtools/debugger/types'

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

// Module script injected into the page via addScriptTag.
// Uses the app's module graph (via Vite's /@id/ resolution) so that
// solid-js and @solid-devtools/debugger share the same runtime as the app.
const DEBUGGER_MODULE_SCRIPT = `
  const { createRoot } = await import('/@id/solid-js');
  const { useDebugger } = await import('/@id/@solid-devtools/debugger');

  createRoot(() => {
    const instance = useDebugger();
    const solidPlugin = window.__introspect_plugins__?.solid;
    if (solidPlugin?.onDebuggerReady) {
      solidPlugin.onDebuggerReady(instance);
    }
  });
`

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
      ext: 'json',
      metadata: { timestamp: captureTimestamp },
    })
  }

  if (state.dgraph !== null) {
    await context.writeAsset({
      kind: 'solid-dgraph',
      content: JSON.stringify(state.dgraph),
      ext: 'json',
      metadata: { timestamp: captureTimestamp },
    })
  }

  if (state.updates !== null) {
    await context.writeAsset({
      kind: 'solid-updates',
      content: JSON.stringify(state.updates),
      ext: 'json',
      metadata: { timestamp: captureTimestamp },
    })
  }
}

async function injectDebuggerModule(context: PluginContext): Promise<void> {
  try {
    const isReady = await context.page.evaluate(() => {
      const setupApi = (globalThis as Record<string, unknown>).SolidDevtools$$
      if (!setupApi) return false
      const api = setupApi as Record<string, unknown>
      return !!(api.DEV || api.Solid)
    })

    if (!isReady) return

    // Inject as a module script so it uses the app's module graph.
    // page.addScriptTag is a Playwright API, but we only have PluginPage
    // which only exposes evaluate(). Use evaluate to create the script tag.
    await context.page.evaluate((script) => {
      const tag = document.createElement('script')
      tag.type = 'module'
      tag.textContent = script
      document.head.appendChild(tag)
    }, DEBUGGER_MODULE_SCRIPT)
  } catch {
    // Injection failed — page may have navigated or setup is incomplete
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

      // Try to inject debugger now (SolidDevtools$$ may already exist)
      await injectDebuggerModule(context)

      // Listen for the browser-side detection signal via CDP.
      // When SolidDevtools$$ is detected, the browser script pushes 'solid.detected'.
      // Listen for the detection signal after navigations.
      // After each navigation, addInitScript re-runs browser.ts, resetting config.
      // We must re-deliver config and inject the debugger each time.
      context.cdpSession.on('Runtime.bindingCalled', (rawParameters: unknown) => {
        const parameters = rawParameters as { name: string; payload: string }
        if (parameters.name !== '__introspect_push__') return
        try {
          const { type } = JSON.parse(parameters.payload) as { type: string }
          if (type === 'solid.detected') {
            void (async () => {
              // Re-deliver config (browser script resets on navigation)
              await context.page.evaluate((pluginOptions) => {
                ;(window.__introspect_plugins__ as { solid?: { configure?(config: unknown): void } } | undefined)
                  ?.solid?.configure?.(pluginOptions)
              }, resolvedOptions)
              await injectDebuggerModule(context)
            })()
          }
        } catch { /* ignore malformed push */ }
      })

      context.bus.on('manual', async () => { await captureState(context) })
      context.bus.on('js.error', async () => { await captureState(context) })
      context.bus.on('detach', async () => { await captureState(context) })
    },
  }
}
