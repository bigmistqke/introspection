import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { TraceEvent, SessionMeta, AssetRef } from '@introspection/types'

export interface FixtureSessionOptions {
  id: string
  startedAt: number
  endedAt?: number
  label?: string
  events?: TraceEvent[]
  assets?: Array<{ path: string; content: string | Buffer }>
}

/** Writes a session directory matching the on-disk layout produced by @introspection/write. */
export async function writeFixtureSession(dir: string, options: FixtureSessionOptions): Promise<void> {
  const sessionDir = join(dir, options.id)
  await mkdir(join(sessionDir, 'assets'), { recursive: true })

  const meta: SessionMeta = {
    version: '2',
    id: options.id,
    startedAt: options.startedAt,
    endedAt: options.endedAt,
    label: options.label,
  }
  await writeFile(join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2))

  const ndjson = (options.events ?? []).map(event => JSON.stringify(event)).join('\n')
  await writeFile(join(sessionDir, 'events.ndjson'), ndjson ? ndjson + '\n' : '')

  for (const asset of options.assets ?? []) {
    await writeFile(join(sessionDir, asset.path), asset.content)
  }
}

export function markEvent(id: string, timestamp: number, label: string): TraceEvent {
  return { id, type: 'mark', timestamp, metadata: { label } }
}

export function networkRequestEvent(id: string, timestamp: number, url: string, assets?: AssetRef[]): TraceEvent {
  return {
    id,
    type: 'network.request',
    timestamp,
    assets,
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
