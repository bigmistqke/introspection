import type { TraceEvent, AssetRef, SessionReader, EventsFilter, Watchable, WatchableWithFilter } from '@introspection/types'
import { createDebug } from '@introspection/utils'

export type { SessionReader, EventsFilter, EventsAPI, AssetsAPI, Watchable, WatchableWithFilter } from '@introspection/types'

// ─── Adapter ─────────────────────────────────────────────────────────────────

export interface StorageAdapter {
  listDirectories(): Promise<string[]>
  readText(path: string): Promise<string>
  readBinary?(path: string): Promise<ArrayBuffer>
}

// ─── Session summary ─────────────────────────────────────────────────────────

export interface SessionSummary {
  id: string
  label?: string
  startedAt: number
  endedAt?: number
  duration?: number
}

// ─── Query functions ─────────────────────────────────────────────────────────

export async function listSessions(adapter: StorageAdapter): Promise<SessionSummary[]> {
  const sessionIds = await adapter.listDirectories()
  if (sessionIds.length === 0) return []

  const sessions: SessionSummary[] = []

  for (const id of sessionIds) {
    try {
      const raw = await adapter.readText(`${id}/meta.json`)
      const meta = JSON.parse(raw) as {
        id: string
        startedAt: number
        endedAt?: number
        label?: string
      }
      sessions.push({
        id: meta.id,
        label: meta.label,
        startedAt: meta.startedAt,
        endedAt: meta.endedAt,
        duration: meta.endedAt ? meta.endedAt - meta.startedAt : undefined,
      })
    } catch {
      // skip malformed sessions
    }
  }

  return sessions.sort((a, b) => b.startedAt - a.startedAt)
}

export interface CreateSessionReaderOptions {
  sessionId?: string
  verbose?: boolean
}

export async function createSessionReader(adapter: StorageAdapter, options?: CreateSessionReaderOptions): Promise<SessionReader> {
  const debug = createDebug('session-reader', options?.verbose ?? false)

  const id = options?.sessionId ?? (await getLatestSessionId(adapter))
  if (!id) throw new Error('No sessions found')

  const initialEvents = await loadEvents(adapter, id)
  debug('loaded', initialEvents.length, 'events from', id)

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
      const types = Array.isArray(filter.type) ? filter.type : [filter.type]
      result = result.filter(event => types.includes(event.type))
    }
    if (filter?.source) {
      const sources = Array.isArray(filter.source) ? filter.source : [filter.source]
      result = result.filter(event => sources.includes(event.source))
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
    events: {
      ls,
      query,
      push(event: TraceEvent) {
        debug('push', event.type, event.id)
        events.push(event)
        notify()
      },
    },
    assets: {
      ls: () => {
        const refs: AssetRef[] = []
        for (const event of events) {
          if (event.assets) refs.push(...event.assets)
        }
        return Promise.resolve(refs)
      },
      metadata: (path) => {
        for (const event of events) {
          if (event.assets) {
            const found = event.assets.find(asset => asset.path === path)
            if (found) return Promise.resolve(found)
          }
        }
        return Promise.resolve(undefined)
      },
      readText: (path) => adapter.readText(`${id}/${path}`),
      readBinary: adapter.readBinary
        ? (path) => adapter.readBinary!(`${id}/${path}`)
        : undefined,
    },
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function getLatestSessionId(adapter: StorageAdapter): Promise<string | null> {
  const sessionIds = await adapter.listDirectories()
  if (sessionIds.length === 0) return null

  const metas = await Promise.all(
    sessionIds.map(async id => {
      try {
        const raw = await adapter.readText(`${id}/meta.json`)
        const meta = JSON.parse(raw) as { startedAt: number }
        return { id, startedAt: meta.startedAt }
      } catch {
        return { id, startedAt: 0 }
      }
    })
  )
  metas.sort((a, b) => b.startedAt - a.startedAt)
  return metas[0].id
}

async function loadEvents(adapter: StorageAdapter, sessionId: string): Promise<TraceEvent[]> {
  const eventsRaw = await adapter.readText(`${sessionId}/events.ndjson`)
  return eventsRaw
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as TraceEvent)
}
