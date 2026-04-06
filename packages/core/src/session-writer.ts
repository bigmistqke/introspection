import { writeFile, mkdir, appendFile, readFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { TraceEvent, SessionMeta, BodySummary } from '@introspection/types'

export interface SessionInitParams {
  id: string
  startedAt: number
  label?: string
}

export function summariseBody(raw: string): BodySummary {
  let parsed: Record<string, unknown>
  try {
    const p = JSON.parse(raw)
    if (typeof p !== 'object' || p === null || Array.isArray(p)) {
      return { keys: [], scalars: {}, arrays: {}, errorFields: {} }
    }
    parsed = p
  } catch { return { keys: [], scalars: {}, arrays: {}, errorFields: {} } }

  const keys = Object.keys(parsed)
  const scalars: Record<string, string | number | boolean | null> = {}
  const arrays: Record<string, { length: number; itemKeys: string[] }> = {}
  const errorFields: Record<string, unknown> = {}
  const ERROR_KEYS = new Set(['error', 'message', 'code', 'status', 'detail'])

  for (const [k, v] of Object.entries(parsed)) {
    if (Array.isArray(v)) {
      const first = v[0] && typeof v[0] === 'object' ? Object.keys(v[0] as object) : []
      arrays[k] = { length: v.length, itemKeys: first }
    } else if (typeof v !== 'object' || v === null) {
      scalars[k] = v as string | number | boolean | null
    }
    if (ERROR_KEYS.has(k)) errorFields[k] = v
  }
  return { keys, scalars, arrays, errorFields }
}

export async function initSessionDir(outDir: string, params: SessionInitParams): Promise<void> {
  const sessionDir = join(outDir, params.id)
  await mkdir(join(sessionDir, 'assets'), { recursive: true })
  const meta: SessionMeta = { version: '2', id: params.id, startedAt: params.startedAt, label: params.label }
  await writeFile(join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2))
  await writeFile(join(sessionDir, 'events.ndjson'), '')
}

export async function appendEvent(outDir: string, sessionId: string, event: TraceEvent): Promise<void> {
  await appendFile(join(outDir, sessionId, 'events.ndjson'), JSON.stringify(event) + '\n')
}

/** Writes content to assets/<uuid>.<kind>.<ext>, appends an asset event, and returns the relative path. */
export async function writeAsset(opts: {
  directory: string
  name: string
  kind: string
  content: string | Buffer
  ext?: string
  metadata: { timestamp: number; [key: string]: unknown }
}): Promise<string> {
  const { directory, name, kind, content, ext = 'json', metadata } = opts
  const uuid = randomUUID().replace(/-/g, '').slice(0, 8)
  const filename = `${uuid}.${kind}.${ext}`
  const path = `assets/${filename}`
  await writeFile(join(directory, name, path), content)
  const { timestamp, ...rest } = metadata
  const event = {
    id: randomUUID().replace(/-/g, '').slice(0, 8),
    type: 'asset' as const,
    ts: timestamp,
    source: 'agent' as const,
    data: { path, kind, ...rest },
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
