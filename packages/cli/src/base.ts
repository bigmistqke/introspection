import { resolve } from 'path'
import type { StorageAdapter } from '@introspection/types'
import { createNodeAdapter } from '@introspection/read/node'
import { createHttpReadAdapter } from '@introspection/serve/client'

export type ParsedBase =
  | { kind: 'path'; path: string }
  | { kind: 'url'; url: string }

export const DEFAULT_BASE = './.introspect'

/**
 * Parse the value of --base (or `base` in introspect.config.ts) into a
 * tagged result. A value containing `://` is treated as a URL; only http://
 * and https:// are accepted, anything else throws. Any other value is a
 * filesystem path, resolved against process.cwd().
 */
export function parseBase(value: string | undefined): ParsedBase {
  const raw = value ?? DEFAULT_BASE
  if (!raw.includes('://')) {
    return { kind: 'path', path: resolve(raw) }
  }
  const scheme = raw.slice(0, raw.indexOf(':'))
  if (scheme !== 'http' && scheme !== 'https') {
    throw new Error(
      `Unsupported URL scheme '${scheme}' for --base; use http:// or https://`,
    )
  }
  return { kind: 'url', url: raw }
}

export function createAdapterFromBase(value: string | undefined): StorageAdapter {
  const parsed = parseBase(value)
  if (parsed.kind === 'path') return createNodeAdapter(parsed.path)
  return createHttpReadAdapter(parsed.url)
}
