import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import type { TraceFile, AssetEvent } from '@introspection/types'

export interface AssetsOpts {
  kind?: string
  contentType?: string
}

export async function listAssets(trace: TraceFile, opts: AssetsOpts): Promise<string[]> {
  const assetEvents = trace.events.filter((e): e is AssetEvent => e.type === 'asset')
  
  let filtered = assetEvents
  if (opts.kind) {
    filtered = filtered.filter(e => e.data.kind === opts.kind)
  }
  if (opts.contentType) {
    filtered = filtered.filter(e => e.data.contentType === opts.contentType)
  }
  
  return filtered.map(e => e.data.path)
}

export async function readAsset(sessionDir: string, path: string): Promise<{ content: string | Buffer; contentType?: string }> {
  const filePath = join(sessionDir, 'assets', path)
  const fileStat = await stat(filePath)
  
  const ext = path.split('.').pop()?.toLowerCase()
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext ?? '')
  
  if (isImage) {
    const content = await readFile(filePath)
    return { content, contentType: 'image' }
  }
  
  const content = await readFile(filePath, 'utf-8')
  return { content, contentType: ext === 'json' ? 'json' : 'text' }
}

export function getAssetSessionDir(trace: TraceFile, baseDir: string): string {
  return join(baseDir, trace.session.id, 'assets')
}
