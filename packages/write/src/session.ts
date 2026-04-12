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
    async finalize() {
      await bus.emit('detach', { trigger: 'detach', timestamp: timestamp() })
      await queue.flush()
      await finalizeSession(outDir, id, Date.now())
    },
  }
}
