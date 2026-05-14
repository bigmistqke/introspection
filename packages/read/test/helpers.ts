import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { TraceEvent, SessionMeta, RunMeta } from '@introspection/types'

export interface FixtureSessionOptions {
  id: string
  startedAt: number
  endedAt?: number
  label?: string
  project?: string
  status?: SessionMeta['status']
  events?: TraceEvent[]
  assets?: Array<{ path: string; content: string | Buffer }>
}

export interface FixtureRunOptions {
  id: string
  startedAt: number
  endedAt?: number
  status?: RunMeta['status']
  branch?: string
  commit?: string
  sessions?: FixtureSessionOptions[]
}

/** Writes a session directory under a run directory, matching the on-disk layout. */
export async function writeFixtureSession(
  dir: string,
  runId: string,
  options: FixtureSessionOptions,
): Promise<void> {
  const sessionDir = join(dir, runId, options.id)
  await mkdir(join(sessionDir, 'assets'), { recursive: true })

  const meta: SessionMeta = {
    version: '2',
    id: options.id,
    startedAt: options.startedAt,
    endedAt: options.endedAt,
    label: options.label,
    project: options.project,
    status: options.status,
  }
  await writeFile(join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2))

  const ndjson = (options.events ?? []).map(event => JSON.stringify(event)).join('\n')
  await writeFile(join(sessionDir, 'events.ndjson'), ndjson ? ndjson + '\n' : '')

  for (const asset of options.assets ?? []) {
    await writeFile(join(sessionDir, asset.path), asset.content)
  }
}

/** Writes a run directory (RunMeta + its session sub-directories). */
export async function writeFixtureRun(dir: string, options: FixtureRunOptions): Promise<void> {
  const runDir = join(dir, options.id)
  await mkdir(runDir, { recursive: true })

  const meta: RunMeta = {
    version: '1',
    id: options.id,
    startedAt: options.startedAt,
    endedAt: options.endedAt,
    status: options.status,
    branch: options.branch,
    commit: options.commit,
  }
  await writeFile(join(runDir, 'meta.json'), JSON.stringify(meta, null, 2))

  for (const session of options.sessions ?? []) {
    await writeFixtureSession(dir, options.id, session)
  }
}

export function markEvent(id: string, timestamp: number, label: string): TraceEvent {
  return { id, type: 'mark', timestamp, metadata: { label } }
}

export function networkRequestEvent(id: string, timestamp: number, url: string): TraceEvent {
  return {
    id,
    type: 'network.request',
    timestamp,
    metadata: {
      cdpRequestId: id,
      cdpTimestamp: 0,
      cdpWallTime: 0,
      url,
      method: 'GET',
      headers: {},
    },
  }
}
