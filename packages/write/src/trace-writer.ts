import { writeFile, mkdir, appendFile, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { TraceEvent, TraceMeta, PluginMeta, WriteAssetOptions, PayloadAsset } from '@introspection/types'

export interface TraceInitParams {
  id: string
  startedAt: number
  label?: string
  plugins?: PluginMeta[]
  project?: string
}

export async function initTraceDir(outDir: string, parameters: TraceInitParams): Promise<void> {
  const traceDir = join(outDir, parameters.id)
  const exists = await stat(traceDir).then(() => true, () => false)
  if (exists) throw new Error(`Trace directory already exists: ${traceDir}`)
  await mkdir(join(traceDir, 'assets'), { recursive: true })
  const meta: TraceMeta = {
    version: '2',
    id: parameters.id,
    startedAt: parameters.startedAt,
    label: parameters.label,
    plugins: parameters.plugins,
    project: parameters.project,
  }
  await writeFile(join(traceDir, 'meta.json'), JSON.stringify(meta, null, 2))
  await writeFile(join(traceDir, 'events.ndjson'), '')
}

export async function appendEvent(outDir: string, traceId: string, event: TraceEvent): Promise<void> {
  await appendFile(join(outDir, traceId, 'events.ndjson'), JSON.stringify(event) + '\n')
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

export async function finalizeTrace(
  outDir: string,
  traceId: string,
  endedAt: number,
  extras?: { status?: TraceMeta['status'] },
): Promise<void> {
  const metaPath = join(outDir, traceId, 'meta.json')
  const meta = JSON.parse(await readFile(metaPath, 'utf-8')) as TraceMeta
  meta.endedAt = endedAt
  if (extras?.status) meta.status = extras.status
  await writeFile(metaPath, JSON.stringify(meta, null, 2))
}
