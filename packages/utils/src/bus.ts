import type { BusPayloadMap, BusTrigger } from '@introspection/types'

type BusHandler<T extends BusTrigger> = (payload: BusPayloadMap[T]) => void | Promise<void>

export interface Bus {
  on<T extends BusTrigger>(trigger: T, handler: BusHandler<T>): void
  emit<T extends BusTrigger>(trigger: T, payload: BusPayloadMap[T]): Promise<void>
}

function isInternalChannel(trigger: string): boolean {
  return trigger.startsWith('introspect:')
}

export function createBus(): Bus {
  const handlers = new Map<string, Array<(payload: unknown) => void | Promise<void>>>()

  const bus: Bus = {
    on<T extends BusTrigger>(trigger: T, handler: BusHandler<T>) {
      const existing = handlers.get(trigger) ?? []
      existing.push(handler as (payload: unknown) => void | Promise<void>)
      handlers.set(trigger, existing)
    },

    async emit<T extends BusTrigger>(trigger: T, payload: BusPayloadMap[T]) {
      const registered = handlers.get(trigger) ?? []
      const results = await Promise.allSettled(
        registered.map(handler => Promise.resolve().then(() => handler(payload))),
      )
      for (const result of results) {
        if (result.status !== 'rejected') continue
        const cause = result.reason
        console.error(`[bus] handler for "${trigger}" rejected:`, cause)
        if (isInternalChannel(trigger)) continue
        const message = cause instanceof Error ? cause.message : String(cause)
        const name = cause instanceof Error ? cause.name : 'Error'
        const source = 'plugin' as const
        void bus.emit('introspect:warning', {
          error: {
            name,
            message: `bus handler for "${trigger}" rejected: ${message}`,
            source,
            cause,
            stack: cause instanceof Error ? cause.stack : undefined,
          },
        })
      }
    },
  }

  return bus
}
