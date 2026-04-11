import type { TraceEvent, AssetEvent, SessionReader, EventsFilter } from '@introspection/types'

export type { SessionReader, EventsFilter, EventsAPI, AssetsAPI } from '@introspection/types'

// ─── Adapter ─────────────────────────────────────────────────────────────────

export interface StorageAdapter {
  listDirectories(): Promise<string[]>
  readText(path: string): Promise<string>
  fileSize(path: string): Promise<number>
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

export async function createSession(adapter: StorageAdapter, sessionId?: string): Promise<SessionReader> {
  const id = sessionId ?? (await getLatestSessionId(adapter))
  if (!id) throw new Error('No sessions found')

  const { events } = await loadTrace(adapter, id)

  return {
    id,
    events: {
      ls: () => Promise.resolve(events),
      query: (filter) => Promise.resolve(queryEvents(events, filter)),
    },
    assets: {
      ls: () => Promise.resolve(events.filter((event): event is AssetEvent => event.type === 'asset')),
      read: (path) => readAssetContent(adapter, id, path),
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

async function loadTrace(adapter: StorageAdapter, sessionId: string): Promise<{ events: TraceEvent[] }> {
  const eventsRaw = await adapter.readText(`${sessionId}/events.ndjson`)
  const events: TraceEvent[] = eventsRaw
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as TraceEvent)

  return { events }
}

function queryEvents(events: TraceEvent[], filter: EventsFilter): TraceEvent[] {
  let result = events
  if (filter.type) {
    const types = filter.type.split(',').map(type => type.trim())
    result = result.filter(event => types.includes(event.type))
  }
  if (filter.source) {
    result = result.filter(event => event.source === filter.source)
  }
  return result
}

async function readAssetContent(
  adapter: StorageAdapter,
  sessionId: string,
  path: string
): Promise<string | { path: string; sizeKB: number }> {
  const extension = path.split('.').pop()?.toLowerCase()
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension ?? '')

  if (isImage) {
    const size = await adapter.fileSize(`${sessionId}/assets/${path}`)
    return {
      path,
      sizeKB: size / 1024,
    }
  }

  return await adapter.readText(`${sessionId}/assets/${path}`)
}
