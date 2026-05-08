import { writeFile, mkdir, appendFile, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { TraceEvent, SessionMeta, PluginMeta, WriteAssetOptions, PayloadAsset } from '@introspection/types'

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

/** Writes content to assets/<id>.<ext> and returns a PayloadAsset. Does not emit an event. */
export async function writeAsset(
  options: WriteAssetOptions & {
    directory: string
    name: string
    id?: string
  },
): Promise<PayloadAsset> {
  const { directory, name, format, content, ext = 'json' } = options
  const id = options.id ?? randomUUID().replace(/-/g, '').slice(0, 8)
  const filename = `${id}.${ext}`
  const path = `assets/${filename}`
  const data = typeof content === 'string'
    ? content
    : new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
  await writeFile(join(directory, name, path), data)
  const size = typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength
  return { kind: 'asset', format, path, size }
}

export async function finalizeSession(outDir: string, sessionId: string, endedAt: number): Promise<void> {
  const metaPath = join(outDir, sessionId, 'meta.json')
  const meta = JSON.parse(await readFile(metaPath, 'utf-8')) as SessionMeta
  meta.endedAt = endedAt
  await writeFile(metaPath, JSON.stringify(meta, null, 2))
}
