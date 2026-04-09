export function capture(label?: string): void {
  ;(window as Record<string, unknown>).__introspect_capture__(label)
}
