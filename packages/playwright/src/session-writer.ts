import { writeFile, mkdir, appendFile, readFile } from 'fs/promises'
import { join } from 'path'
import type { TraceEvent, OnErrorSnapshot, SessionMeta, BodySummary } from '@introspection/types'

export interface SessionInitParams {
  id: string
  startedAt: number
  label?: string
}

function summariseBody(raw: string): BodySummary {
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
  await mkdir(join(sessionDir, 'snapshots'), { recursive: true })
  const meta: SessionMeta = {
    version: '2',
    id: params.id,
    startedAt: params.startedAt,
    label: params.label,
  }
  await writeFile(join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2))
  await writeFile(join(sessionDir, 'events.ndjson'), '')
}

export async function appendEvent(outDir: string, sessionId: string, event: TraceEvent, bodyMap?: Map<string, string>): Promise<void> {
  const sessionDir = join(outDir, sessionId)
  let evt = event

  if (evt.type === 'network.response' && bodyMap?.has(evt.id)) {
    const raw = bodyMap.get(evt.id)!
    evt = { ...evt, data: { ...evt.data, bodySummary: summariseBody(raw) } }
    const bodiesDir = join(sessionDir, 'bodies')
    await mkdir(bodiesDir, { recursive: true })
    await writeFile(join(bodiesDir, `${evt.id}.json`), raw)
  }

  await appendFile(join(sessionDir, 'events.ndjson'), JSON.stringify(evt) + '\n')
}

export async function writeSnapshot(outDir: string, sessionId: string, snapshot: OnErrorSnapshot): Promise<void> {
  const snapshotsDir = join(outDir, sessionId, 'snapshots')
  await mkdir(snapshotsDir, { recursive: true })
  await writeFile(join(snapshotsDir, `${snapshot.trigger}.json`), JSON.stringify(snapshot, null, 2))
}

export async function finalizeSession(outDir: string, sessionId: string, endedAt: number): Promise<void> {
  const metaPath = join(outDir, sessionId, 'meta.json')
  const raw = await readFile(metaPath, 'utf-8')
  const meta = JSON.parse(raw) as SessionMeta
  meta.endedAt = endedAt
  await writeFile(metaPath, JSON.stringify(meta, null, 2))
}
