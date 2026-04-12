import { randomUUID } from 'crypto'
import type { SessionWriter, TraceEvent, BusPayloadMap, PluginMeta, EmitInput } from '@introspection/types'
import { initSessionDir, appendEvent, writeAsset, finalizeSession } from './session-writer.js'
import { createBus } from '@introspection/utils'

export interface CreateSessionWriterOptions {
  outDir?: string
  id?: string
  label?: string
  plugins?: PluginMeta[]
}

function createWriteQueue() {
  let pending: Promise<void> = Promise.resolve()

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation)
    pending = result.then(() => {}, () => {})
    return result
  }

  function flush(): Promise<void> {
    return pending
  }

  return { enqueue, flush }
}

function createTracker() {
  const pending = new Set<Promise<unknown>>()

  function track(operation: () => Promise<unknown>): void {
    const promise = operation()
    pending.add(promise)
    promise.finally(() => pending.delete(promise))
  }

  async function flush(): Promise<void> {
    while (pending.size > 0) {
      await Promise.allSettled(Array.from(pending))
    }
  }

  return { track, flush }
}

export async function createSessionWriter(options: CreateSessionWriterOptions = {}): Promise<SessionWriter> {
  const id = options.id ?? randomUUID()
  const outDir = options.outDir ?? '.introspect'
  const startedAt = Date.now()

  await initSessionDir(outDir, {
    id,
    startedAt,
    label: options.label,
    plugins: options.plugins,
  })

  const bus = createBus()
  const queue = createWriteQueue()
  const tracker = createTracker()

  function timestamp(): number {
    return Date.now() - startedAt
  }

  function emit(event: EmitInput): Promise<void> {
    const full = { id: randomUUID(), timestamp: timestamp(), ...event } as TraceEvent
    const writePromise = queue.enqueue(() => appendEvent(outDir, id, full))
    void bus.emit(full.type, full as BusPayloadMap[typeof full.type])
    return writePromise
  }

  return {
    id,
    emit,
    async writeAsset(options) {
      return queue.enqueue(() => writeAsset({
        ...options,
        directory: outDir,
        name: id,
      }))
    },
    timestamp,
    bus,
    track: (operation) => tracker.track(operation),
    async flush() {
      await tracker.flush()
      await queue.flush()
    },
    async finalize() {
      await bus.emit('detach', { trigger: 'detach', timestamp: timestamp() })
      await tracker.flush()
      await queue.flush()
      await finalizeSession(outDir, id, Date.now())
    },
  }
}
