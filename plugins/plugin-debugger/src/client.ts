declare global {
  interface Window {
    __introspect_plugin_debugger_capture__: (label?: string) => void
  }
}

export function capture(label?: string): void {
  window.__introspect_plugin_debugger_capture__(label)
}
