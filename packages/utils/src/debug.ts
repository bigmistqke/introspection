export type DebugCallback = (message: string, args: unknown[]) => void

export interface DebugFn {
  (message: string, ...args: unknown[]): void
  subscribe(callback: DebugCallback): () => void
}

export function createDebug(label: string, verbose: boolean): DebugFn {
  const subscribers = new Set<DebugCallback>()

  const fn = ((message: string, ...args: unknown[]) => {
    if (verbose) console.log(`[${label}]`, message, ...args)
    for (const subscriber of subscribers) subscriber(message, args)
  }) as DebugFn

  fn.subscribe = (callback) => {
    subscribers.add(callback)
    return () => { subscribers.delete(callback) }
  }

  return fn
}
