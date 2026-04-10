import { randomUUID } from 'crypto'
import type { Session, TraceEvent, BusPayloadMap, PluginMeta, EventSource } from '@introspection/types'
import { initSessionDir, appendEvent, writeAsset, finalizeSession } from './session-writer.js'
import { createBus } from './bus.js'

export interface CreateSessionOptions {
  outDir?: string
  id?: string
  label?: string
  plugins?: PluginMeta[]
}

export async function createSession(options: CreateSessionOptions = {}): Promise<Session> {
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
        directory: outDir,
        name: id,
        kind: options.kind,
        content: options.content,
        ext: options.ext,
        metadata: options.metadata,
        source: options.source ?? 'agent',
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
