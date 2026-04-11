import { writeFile, mkdir, appendFile, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { TraceEvent, SessionMeta, EventSource, PluginMeta } from '@introspection/types'

export interface SessionInitParams {
  id: string
  startedAt: number
  label?: string
  plugins?: PluginMeta[]
}

export async function initSessionDir(outDir: string, parameters: SessionInitParams): Promise<void> {
  const sessionDir = join(outDir, parameters.id)
  const exists = await stat(sessionDir).then(() => true, () => false)
  if (exists) throw new Error(`Session directory already exists: ${sessionDir}`)
  await mkdir(join(sessionDir, 'assets'), { recursive: true })
  const meta: SessionMeta = {
    version: '2',
    id: parameters.id,
    startedAt: parameters.startedAt,
    label: parameters.label,
    plugins: parameters.plugins,
  }
  await writeFile(join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2))
  await writeFile(join(sessionDir, 'events.ndjson'), '')
}

export async function appendEvent(outDir: string, sessionId: string, event: TraceEvent): Promise<void> {
  await appendFile(join(outDir, sessionId, 'events.ndjson'), JSON.stringify(event) + '\n')
}

/** Writes content to assets/<id>.<kind>.<ext>, appends an asset event, and returns the relative path. */
export async function writeAsset(opts: {
  directory: string
  name: string
  kind: string
  content: string | Buffer
  ext?: string
  id?: string
  metadata: { timestamp: number; [key: string]: unknown }
  source?: EventSource
}): Promise<string> {
  const { directory, name, kind, content, ext = 'json', metadata, source } = opts
  const id = opts.id ?? randomUUID().replace(/-/g, '').slice(0, 8)
  const filename = `${id}.${kind}.${ext}`
  const path = `assets/${filename}`
  await writeFile(join(directory, name, path), content)
  const size = typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength
  const { timestamp, ...rest } = metadata
  const event = {
    id: randomUUID().replace(/-/g, '').slice(0, 8),
    type: 'asset' as const,
    timestamp,
    source: (source ?? 'agent') as EventSource,
    data: { path, kind, size, ...rest },
  }
  await appendFile(join(directory, name, 'events.ndjson'), JSON.stringify(event) + '\n')
  return path
}

export async function finalizeSession(outDir: string, sessionId: string, endedAt: number): Promise<void> {
  const metaPath = join(outDir, sessionId, 'meta.json')
  const meta = JSON.parse(await readFile(metaPath, 'utf-8')) as SessionMeta
  meta.endedAt = endedAt
  await writeFile(metaPath, JSON.stringify(meta, null, 2))
}
