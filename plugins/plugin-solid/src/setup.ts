// User-facing setup module. Import this in your app entry alongside 'solid-devtools':
//
//   import 'solid-devtools'
//   import '@introspection/plugin-solid/setup'
//
// This creates the debugger instance using the app's solid-js runtime and
// exposes it on a global for the browser IIFE to consume. Because this module
// is bundled by the user's bundler (Vite, webpack, etc.), it shares the same
// solid-js and @solid-devtools/debugger instances as the app — no version
// mismatch or duplicate runtime issues.

import { createRoot } from 'solid-js'
import { useDebugger } from '@solid-devtools/debugger'

const GLOBAL_KEY = '__introspect_solid_debugger__'

createRoot(() => {
  const instance = useDebugger()

  ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = instance

  // If the browser IIFE already registered onDebuggerReady, call it immediately
  const solidPlugin = (window as unknown as Record<string, unknown>).__introspect_plugins__
  const plugin = (solidPlugin as Record<string, unknown> | undefined)?.solid as
    { onDebuggerReady?: (instance: unknown) => void } | undefined
  if (plugin?.onDebuggerReady) {
    plugin.onDebuggerReady(instance)
  }
})
