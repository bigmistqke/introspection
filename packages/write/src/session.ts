import { randomUUID } from 'crypto'
import { dirname, isAbsolute, join } from 'path'
import { mkdir, writeFile as fsWriteFile } from 'fs/promises'
import type { SessionWriter, TraceEvent, BusPayloadMap, PluginMeta, EmitInput, SessionMeta, WriteAssetOptions, PayloadAsset, IntrospectionReporter, ReporterContext } from '@introspection/types'
import type { MemoryWriteAdapter } from './memory.js'
import { initSessionDir, appendEvent, writeAsset, finalizeSession } from './session-writer.js'
import { createBus } from '@introspection/utils'
import { createReporterRunner } from './reporter-lifecycle.js'

export interface CreateSessionWriterOptions {
  outDir?: string
  id?: string
  label?: string
  plugins?: PluginMeta[]
  reporters?: IntrospectionReporter[]
  adapter?: MemoryWriteAdapter
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
  const adapter = options.adapter
  const reporters = options.reporters ?? []

  const meta: SessionMeta = {
    version: '2',
    id,
    startedAt,
    label: options.label,
    plugins: options.plugins,
  }

  if (adapter) {
    await adapter.writeText(`${id}/meta.json`, JSON.stringify(meta, null, 2))
    await adapter.writeText(`${id}/events.ndjson`, '')
  } else {
    await initSessionDir(outDir, {
      id,
      startedAt,
      label: options.label,
      plugins: options.plugins,
    })
  }

  const bus = createBus()
  const queue = createWriteQueue()
  const tracker = createTracker()

  const sessionDir = join(outDir, id)
  const reporterCtx: ReporterContext = {
    sessionId: id,
    outDir: sessionDir,
    runDir: outDir,
    meta,
    writeFile: async (target, content) => {
      const resolved = isAbsolute(target) ? target : join(outDir, target)
      await mkdir(dirname(resolved), { recursive: true })
      await fsWriteFile(resolved, content)
    },
    track: (operation) => tracker.track(operation),
  }
  const reporterRunner = createReporterRunner(reporters, reporterCtx, bus)
  await reporterRunner.start()

  function timestamp(): number {
    return Date.now() - startedAt
  }

  function emit(event: EmitInput): Promise<void> {
    const full = { id: randomUUID(), timestamp: timestamp(), ...event } as TraceEvent
    const writePromise = queue.enqueue(async () => {
      if (adapter) {
        const path = `${id}/events.ndjson`
        const line = JSON.stringify(full) + '\n'
        await adapter.appendText(path, line)
      } else {
        await appendEvent(outDir, id, full)
      }
    })
    void bus.emit(full.type, full as BusPayloadMap[typeof full.type])
    reporterRunner.handleEvent(full)
    return writePromise
  }

  return {
    id,
    emit,
    async writeAsset(options) {
      return queue.enqueue(async () => {
        if (adapter) {
          const assetId = randomUUID().replace(/-/g, '').slice(0, 8)
          const ext = options.ext ?? 'json'
          const path = `${id}/assets/${assetId}.${ext}`
          await adapter.writeAsset(path, options.content)
          const size = typeof options.content === 'string' ? Buffer.byteLength(options.content) : options.content.byteLength
          return { kind: 'asset', format: options.format, path, size } satisfies PayloadAsset
        }
        return writeAsset({
          ...options,
          directory: outDir,
          name: id,
        })
      })
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
      if (adapter) {
        await adapter.writeText(`${id}/meta.json`, JSON.stringify({ ...meta, endedAt: Date.now() }, null, 2))
      } else {
        await finalizeSession(outDir, id, Date.now())
      }
    },
  }
}
