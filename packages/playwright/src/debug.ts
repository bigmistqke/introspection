export function createDebug(title: string, enabled: boolean) {
  if (!enabled) return (..._args: unknown[]) => {}
  return (...args: unknown[]) => console.error(`[${title}]`, ...args)
}
