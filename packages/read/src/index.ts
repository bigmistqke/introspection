import type { TraceEvent, SessionReader, SessionMeta, RunMeta, SessionStatus, EventsFilter, Watchable, WatchableWithFilter, StorageAdapter, PayloadRef } from '@introspection/types'
import { createDebug } from '@introspection/utils'

export type { SessionReader, EventsFilter, EventsAPI, Watchable, WatchableWithFilter, StorageAdapter } from '@introspection/types'
export { createMemoryReadAdapter } from './memory.js'

// ─── Type matching ───────────────────────────────────────────────────────────

/**
 * Matches an event type against a pattern. Supports trailing `.*` for prefix
 * matching (e.g. `network.*` matches `network.request`, `network.response`,
 * `network.error`). Bare patterns are exact-match.
 */
export function matchEventType(pattern: string, eventType: string): boolean {
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2)
    return eventType === prefix || eventType.startsWith(prefix + '.')
  }
  return eventType === pattern
}

// ─── Run & session summaries ─────────────────────────────────────────────────

export interface RunSummary {
  id: string
  startedAt: number
  endedAt?: number
  status?: RunMeta['status']
  branch?: string
  commit?: string
  sessionCount: number
}

export interface SessionSummary {
  id: string
  label?: string
  project?: string
  status?: SessionStatus
  startedAt: number
  endedAt?: number
  duration?: number
}

// ─── Query functions ─────────────────────────────────────────────────────────

export async function listRuns(adapter: StorageAdapter): Promise<RunSummary[]> {
  const runIds = await adapter.listDirectories()
  if (runIds.length === 0) return []

  const results = await Promise.all(
    runIds.map(async (id): Promise<RunSummary | null> => {
      try {
        const meta = JSON.parse(await adapter.readText(`${id}/meta.json`)) as RunMeta
        const sessions = await adapter.listDirectories(id)
        return {
          id: meta.id,
          startedAt: meta.startedAt,
          endedAt: meta.endedAt,
          status: meta.status,
          branch: meta.branch,
          commit: meta.commit,
          sessionCount: sessions.length,
        }
      } catch {
        return null // skip malformed runs
      }
    })
  )

  return results.filter((r): r is RunSummary => r !== null).sort((a, b) => b.startedAt - a.startedAt)
}

export async function listSessions(adapter: StorageAdapter, runId: string): Promise<SessionSummary[]> {
  const sessionIds = await adapter.listDirectories(runId)
  if (sessionIds.length === 0) return []

  const results = await Promise.all(
    sessionIds.map(async (id): Promise<SessionSummary | null> => {
      try {
        const meta = JSON.parse(await adapter.readText(`${runId}/${id}/meta.json`)) as SessionMeta
        return {
          id: meta.id,
          label: meta.label,
          project: meta.project,
          status: meta.status,
          startedAt: meta.startedAt,
          endedAt: meta.endedAt,
          duration: meta.endedAt ? meta.endedAt - meta.startedAt : undefined,
        }
      } catch {
        return null // skip malformed sessions
      }
    })
  )

  return results.filter((s): s is SessionSummary => s !== null).sort((a, b) => b.startedAt - a.startedAt)
}

export interface CreateSessionReaderOptions {
  runId?: string
  sessionId?: string
  verbose?: boolean
}

export async function createSessionReader(adapter: StorageAdapter, options?: CreateSessionReaderOptions): Promise<SessionReader> {
  const debug = createDebug('session-reader', options?.verbose ?? false)

  const runId = options?.runId ?? (await getLatestRunId(adapter))
  if (!runId) throw new Error('No runs found')

  const id = options?.sessionId ?? (await getLatestSessionId(adapter, runId))
  if (!id) throw new Error(`No sessions in run '${runId}'`)

  const prefix = `${runId}/${id}`

  const metaRaw = await adapter.readText(`${prefix}/meta.json`)
  const meta = JSON.parse(metaRaw) as SessionMeta

  const initialEvents = await loadEvents(adapter, prefix)
  debug('loaded', initialEvents.length, 'events from', prefix)

  // Mutable event store
  const events: TraceEvent[] = [...initialEvents]
  const subscribers = new Set<() => void>()

  function notify() {
    debug('notify', subscribers.size, 'subscribers,', events.length, 'total events')
    for (const callback of subscribers) {
      callback()
    }
  }

  function filterEvents(filter?: EventsFilter): TraceEvent[] {
    let result = events
    if (filter?.type) {
      const patterns = Array.isArray(filter.type) ? filter.type : [filter.type]
      result = result.filter(event => patterns.some(pattern => matchEventType(pattern, event.type)))
    }
    if (filter?.since !== undefined) {
      result = result.filter(event => event.timestamp >= filter.since!)
    }
    if (filter?.until !== undefined) {
      result = result.filter(event => event.timestamp <= filter.until!)
    }
    if (filter?.initiator) {
      result = result.filter(event => event.initiator === filter.initiator)
    }
    return result
  }

  let watchCount = 0

  function createWatchIterable(filter?: EventsFilter): AsyncIterable<TraceEvent[]> {
    const watchId = ++watchCount
    const label = filter ? JSON.stringify(filter) : '*'
    debug('watch.create', `#${watchId}`, label)

    return {
      [Symbol.asyncIterator]() {
        let resolve: ((value: IteratorResult<TraceEvent[]>) => void) | null = null
        let done = false
        let needsInitial = true

        const onUpdate = () => {
          if (resolve) {
            const filtered = filterEvents(filter)
            debug('watch.yield', `#${watchId}`, filtered.length, 'events')
            const current = resolve
            resolve = null
            current({ value: filtered, done: false })
          }
        }

        subscribers.add(onUpdate)

        return {
          next() {
            if (done) return Promise.resolve({ value: undefined as unknown as TraceEvent[], done: true })
            // Yield current snapshot immediately on first call
            if (needsInitial) {
              needsInitial = false
              const filtered = filterEvents(filter)
              debug('watch.initial', `#${watchId}`, filtered.length, 'events')
              return Promise.resolve({ value: filtered, done: false } as IteratorResult<TraceEvent[]>)
            }
            debug('watch.waiting', `#${watchId}`)
            return new Promise<IteratorResult<TraceEvent[]>>(r => { resolve = r })
          },
          return() {
            debug('watch.stop', `#${watchId}`)
            done = true
            subscribers.delete(onUpdate)
            return Promise.resolve({ value: undefined as unknown as TraceEvent[], done: true })
          },
        }
      },
    }
  }

  function ls() { return Promise.resolve([...events]) }
  ls.watch = function () { return createWatchIterable() }

  function query(filter: EventsFilter) { return Promise.resolve(filterEvents(filter)) }
  query.watch = function (filter: EventsFilter) { return createWatchIterable(filter) }

  return {
    id,
    meta,
    events: {
      ls,
      query,
      push(event: TraceEvent) {
        debug('push', event.type, event.id)
        events.push(event)
        notify()
      },
    },
    async resolvePayload(ref: PayloadRef): Promise<unknown> {
      if (ref.kind === 'inline') return ref.value
      const fullPath = `${prefix}/${ref.path}`
      switch (ref.format) {
        case 'json':
          return adapter.readJSON(fullPath)
        case 'html':
        case 'text':
          return adapter.readText(fullPath)
        case 'image':
        case 'binary': {
          if (!adapter.readBinary) throw new Error('adapter does not support binary reads')
          const bytes = await adapter.readBinary(fullPath)
          return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
        }
      }
    },
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function getLatestRunId(adapter: StorageAdapter): Promise<string | null> {
  const runIds = await adapter.listDirectories()
  if (runIds.length === 0) return null

  const metas = await Promise.all(
    runIds.map(async id => {
      try {
        const meta = JSON.parse(await adapter.readText(`${id}/meta.json`)) as { startedAt: number }
        return { id, startedAt: meta.startedAt }
      } catch {
        return { id, startedAt: 0 }
      }
    })
  )
  metas.sort((a, b) => b.startedAt - a.startedAt)
  return metas[0].id
}

async function getLatestSessionId(adapter: StorageAdapter, runId: string): Promise<string | null> {
  const sessionIds = await adapter.listDirectories(runId)
  if (sessionIds.length === 0) return null

  const metas = await Promise.all(
    sessionIds.map(async id => {
      try {
        const meta = JSON.parse(await adapter.readText(`${runId}/${id}/meta.json`)) as { startedAt: number }
        return { id, startedAt: meta.startedAt }
      } catch {
        return { id, startedAt: 0 }
      }
    })
  )
  metas.sort((a, b) => b.startedAt - a.startedAt)
  return metas[0].id
}

async function loadEvents(adapter: StorageAdapter, sessionPrefix: string): Promise<TraceEvent[]> {
  const eventsRaw = await adapter.readText(`${sessionPrefix}/events.ndjson`)
  return eventsRaw
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as TraceEvent)
}
