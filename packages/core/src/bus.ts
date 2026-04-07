import type { BusPayloadMap, BusTrigger } from '@introspection/types'

type BusHandler<T extends BusTrigger> = (payload: BusPayloadMap[T]) => void | Promise<void>

export interface Bus {
  on<T extends BusTrigger>(trigger: T, handler: BusHandler<T>): void
  emit<T extends BusTrigger>(trigger: T, payload: BusPayloadMap[T]): Promise<void>
}

export function createBus(): Bus {
  const handlers = new Map<string, Array<(payload: unknown) => void | Promise<void>>>()

  return {
    on<T extends BusTrigger>(trigger: T, handler: BusHandler<T>) {
      const existing = handlers.get(trigger) ?? []
      existing.push(handler as (payload: unknown) => void | Promise<void>)
      handlers.set(trigger, existing)
    },

    async emit<T extends BusTrigger>(trigger: T, payload: BusPayloadMap[T]) {
      const registered = handlers.get(trigger) ?? []
      await Promise.allSettled(registered.map(handler => Promise.resolve().then(() => handler(payload))))
    },
  }
}
