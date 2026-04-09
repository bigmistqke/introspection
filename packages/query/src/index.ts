import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import type { TraceFile, TraceEvent, AssetEvent } from '@introspection/types'

export interface Session {
  dir: string
  id: string
  events: EventsAPI
  assets: AssetsAPI
}

export interface SessionSummary {
  id: string
  label?: string
  startedAt: number
  endedAt?: number
  duration?: number
}

export async function listSessions(dir: string): Promise<SessionSummary[]> {
  const sessionIds = await listSessionIds(dir)
  if (sessionIds.length === 0) return []

  const sessions: SessionSummary[] = []

  for (const id of sessionIds) {
    try {
      const raw = await readFile(join(dir, id, 'meta.json'), 'utf-8')
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

export interface EventsFilters {
  type?: string
  source?: string
}

export interface EventsAPI {
  ls(): Promise<TraceEvent[]>
  query(filters: EventsFilters): Promise<TraceEvent[]>
}

export interface AssetsAPI {
  ls(): Promise<AssetEvent[]>
  read(path: string): Promise<string | { path: string; sizeKB: number }>
}

export async function createSession(dir: string, sessionId?: string): Promise<Session> {
  const id = sessionId ?? (await getLatestSessionId(dir))
  if (!id) throw new Error(`No sessions found in ${dir}`)

  const trace = await loadTrace(dir, id)

  return {
    dir,
    id,
    events: {
      ls: () => Promise.resolve(trace.events),
      query: (filters) => Promise.resolve(queryEvents(trace.events, filters)),
    },
    assets: {
      ls: () => Promise.resolve(trace.events.filter((e): e is AssetEvent => e.type === 'asset')),
      read: (path) => readAssetContent(dir, id, path),
    },
  }
}

async function getLatestSessionId(dir: string): Promise<string | null> {
  const sessions = await listSessionIds(dir)
  if (sessions.length === 0) return null

  const metas = await Promise.all(
    sessions.map(async id => {
      try {
        const raw = await readFile(join(dir, id, 'meta.json'), 'utf-8')
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

async function listSessionIds(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter(e => e.isDirectory()).map(e => e.name)
  } catch {
    return []
  }
}

async function loadTrace(dir: string, sessionId: string): Promise<TraceFile> {
  const sessionDir = join(dir, sessionId)
  const metaRaw = await readFile(join(sessionDir, 'meta.json'), 'utf-8')
  const meta = JSON.parse(metaRaw) as { version: string; id: string; startedAt: number; endedAt?: number; label?: string }

  const eventsRaw = await readFile(join(sessionDir, 'events.ndjson'), 'utf-8')
  const events: TraceEvent[] = eventsRaw
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as TraceEvent)

  return {
    version: '2',
    session: { id: meta.id, startedAt: meta.startedAt, endedAt: meta.endedAt, label: meta.label },
    events,
    snapshots: [],
  }
}

function queryEvents(events: TraceEvent[], filters: EventsFilters): TraceEvent[] {
  let result = events
  if (filters.type) {
    const types = filters.type.split(',').map(t => t.trim())
    result = result.filter(e => types.includes(e.type))
  }
  if (filters.source) {
    result = result.filter(e => e.source === filters.source)
  }
  return result
}

async function readAssetContent(
  dir: string,
  sessionId: string,
  path: string
): Promise<string | { path: string; sizeKB: number }> {
  const filePath = join(dir, sessionId, 'assets', path)
  const fileStat = await stat(filePath)

  const ext = path.split('.').pop()?.toLowerCase()
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext ?? '')

  if (isImage) {
    return {
      path,
      sizeKB: fileStat.size / 1024,
    }
  }

  return await readFile(filePath, 'utf-8')
}
