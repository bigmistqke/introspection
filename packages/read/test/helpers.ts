import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { TraceEvent, TraceMeta, RunMeta } from '@introspection/types'

export interface FixtureTraceOptions {
  id: string
  startedAt: number
  endedAt?: number
  label?: string
  project?: string
  status?: TraceMeta['status']
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
  traces?: FixtureTraceOptions[]
}

/** Writes a trace directory under a run directory, matching the on-disk layout. */
export async function writeFixtureTrace(
  dir: string,
  runId: string,
  options: FixtureTraceOptions,
): Promise<void> {
  const traceDir = join(dir, runId, options.id)
  await mkdir(join(traceDir, 'assets'), { recursive: true })

  const meta: TraceMeta = {
    version: '2',
    id: options.id,
    startedAt: options.startedAt,
    endedAt: options.endedAt,
    label: options.label,
    project: options.project,
    status: options.status,
  }
  await writeFile(join(traceDir, 'meta.json'), JSON.stringify(meta, null, 2))

  const ndjson = (options.events ?? []).map(event => JSON.stringify(event)).join('\n')
  await writeFile(join(traceDir, 'events.ndjson'), ndjson ? ndjson + '\n' : '')

  for (const asset of options.assets ?? []) {
    await writeFile(join(traceDir, asset.path), asset.content)
  }
}

/** Writes a run directory (RunMeta + its trace sub-directories). */
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

  for (const trace of options.traces ?? []) {
    await writeFixtureTrace(dir, options.id, trace)
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
