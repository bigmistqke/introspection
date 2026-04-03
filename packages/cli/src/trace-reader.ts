import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import type { TraceFile, TraceEvent } from '@introspection/types'

interface FilterOptions { type?: string; url?: string; failed?: boolean }

export class TraceReader {
  constructor(private dir: string) {}

  async loadLatest(): Promise<TraceFile> {
    const files = await this.listTraceFiles()
    if (files.length === 0) throw new Error(`No trace files found in ${this.dir}`)
    const stats = await Promise.all(files.map(async f => ({ f, mtime: (await stat(join(this.dir, f))).mtime })))
    stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    return this.loadFile(stats[0].f)
  }

  async load(name: string): Promise<TraceFile> {
    const filename = name.endsWith('.trace.json') ? name : `${name}.trace.json`
    return this.loadFile(filename)
  }

  async readBody(eventId: string): Promise<string | null> {
    const path = join(this.dir, 'bodies', `${eventId}.json`)
    try { return await readFile(path, 'utf-8') } catch { return null }
  }

  filterEvents(trace: TraceFile, opts: FilterOptions): TraceEvent[] {
    const NETWORK_URL_TYPES = new Set(['network.request', 'network.response', 'network.error'])
    return trace.events.filter(evt => {
      if (opts.type && evt.type !== opts.type) return false
      if (opts.url && NETWORK_URL_TYPES.has(evt.type) && !(evt.data as { url: string }).url.includes(opts.url)) return false
      if (opts.failed && evt.type === 'network.response' && evt.data.status < 400) return false
      // network.error events are always "failed" requests
      return true
    })
  }

  async listTraceFiles(): Promise<string[]> {
    const entries = await readdir(this.dir)
    return entries.filter(f => f.endsWith('.trace.json'))
  }

  private async loadFile(filename: string): Promise<TraceFile> {
    const raw = await readFile(join(this.dir, filename), 'utf-8')
    return JSON.parse(raw) as TraceFile
  }
}
