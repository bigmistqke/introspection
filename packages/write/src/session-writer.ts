import { writeFile, mkdir, appendFile, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { TraceEvent, SessionMeta, EventSource, PluginMeta, WriteAssetOptions, AssetRef } from '@introspection/types'

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

/** Writes content to assets/<id>.<ext> and returns an AssetRef. Does not emit an event. */
export async function writeAsset(
  options: WriteAssetOptions & {
    directory: string
    name: string
    id?: string
  },
): Promise<AssetRef> {
  const { directory, name, kind, content, ext = 'json' } = options
  const id = options.id ?? randomUUID().replace(/-/g, '').slice(0, 8)
  const filename = `${id}.${ext}`
  const path = `assets/${filename}`
  await writeFile(join(directory, name, path), content)
  const size = typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength
  return { path, kind, size }
}

export async function finalizeSession(outDir: string, sessionId: string, endedAt: number): Promise<void> {
  const metaPath = join(outDir, sessionId, 'meta.json')
  const meta = JSON.parse(await readFile(metaPath, 'utf-8')) as SessionMeta
  meta.endedAt = endedAt
  await writeFile(metaPath, JSON.stringify(meta, null, 2))
}
