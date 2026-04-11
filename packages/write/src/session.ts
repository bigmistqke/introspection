import { randomUUID } from 'crypto'
import type { SessionWriter, TraceEvent, BusPayloadMap, PluginMeta, EventSource } from '@introspection/types'
import { initSessionDir, appendEvent, writeAsset, finalizeSession } from './session-writer.js'
import { createBus } from '@introspection/utils'

export interface CreateSessionWriterOptions {
  outDir?: string
  id?: string
  label?: string
  plugins?: PluginMeta[]
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

  function timestamp(): number {
    return Date.now() - startedAt
  }

  function emit(event: Omit<TraceEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: number }) {
    const full = { id: randomUUID(), timestamp: timestamp(), ...event } as TraceEvent
    void appendEvent(outDir, id, full)
    void bus.emit(full.type, full as BusPayloadMap[typeof full.type])
  }

  return {
    id,
    emit,
    async writeAsset(options) {
      return writeAsset({
        ...options,
        directory: outDir,
        name: id,
      })
    },
    timestamp,
    bus,
    async finalize() {
      await bus.emit('detach', { trigger: 'detach', timestamp: timestamp() })
      await finalizeSession(outDir, id, Date.now())
    },
  }
}
