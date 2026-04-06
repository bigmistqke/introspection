import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import type { TraceFile, TraceEvent, AssetEvent } from '@introspection/types'

interface FilterOptions { type?: string; url?: string; failed?: boolean }

export class TraceReader {
  constructor(private dir: string) {}

  async loadLatest(): Promise<TraceFile> {
    const sessions = await this.listSessions()
    if (sessions.length === 0) throw new Error(`No sessions found in ${this.dir}`)
    const metas = await Promise.all(
      sessions.map(async id => {
        try {
          const raw = await readFile(join(this.dir, id, 'meta.json'), 'utf-8')
          const meta = JSON.parse(raw) as { startedAt: number }
          return { id, startedAt: meta.startedAt }
        } catch { return { id, startedAt: 0 } }
      })
    )
    metas.sort((a, b) => b.startedAt - a.startedAt)
    return this.load(metas[0].id)
  }

  async load(sessionId: string): Promise<TraceFile> {
    const sessionDir = join(this.dir, sessionId)
    const metaRaw = await readFile(join(sessionDir, 'meta.json'), 'utf-8')
    const meta = JSON.parse(metaRaw) as {
      version: string; id: string; startedAt: number; endedAt?: number; label?: string
    }

    const eventsRaw = await readFile(join(sessionDir, 'events.ndjson'), 'utf-8')
    const events: TraceEvent[] = eventsRaw
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as TraceEvent)

    const assetEvents = events.filter((e): e is AssetEvent => e.type === 'asset')

    const snapshots: TraceFile['snapshots'] = []
    for (const assetEvt of assetEvents) {
      if (assetEvt.data.kind !== 'snapshot') continue
      try {
        const raw = await readFile(join(sessionDir, assetEvt.data.path), 'utf-8')
        snapshots.push(JSON.parse(raw))
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    }
    snapshots.sort((a, b) => a.ts - b.ts)

    return {
      version: '2',
      session: { id: meta.id, startedAt: meta.startedAt, endedAt: meta.endedAt, label: meta.label },
      events,
      snapshots,
    }
  }

  async readBody(sessionId: string, eventId: string): Promise<string | null> {
    try { return await readFile(join(this.dir, sessionId, 'assets', `${eventId}.body.json`), 'utf-8') } catch { return null }
  }

  filterEvents(trace: TraceFile, opts: FilterOptions): TraceEvent[] {
    const NETWORK_URL_TYPES = new Set(['network.request', 'network.response', 'network.error'])
    return trace.events.filter(evt => {
      if (opts.type && evt.type !== opts.type) return false
      if (opts.url && NETWORK_URL_TYPES.has(evt.type) && !(evt.data as { url: string }).url.includes(opts.url)) return false
      if (opts.failed && evt.type === 'network.response' && (evt.data as { status: number }).status < 400) return false
      return true
    })
  }

  async listSessions(): Promise<string[]> {
    try {
      const entries = await readdir(this.dir, { withFileTypes: true })
      return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }
}
