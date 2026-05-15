import type { StorageAdapter } from '@introspection/types'

/**
 * Creates a StorageAdapter that reads trace data over HTTP from a server
 * mounting @introspection/serve's createHandler. Uses the verb-prefix protocol:
 *
 *   GET <base>/dirs/<subPath?>  → JSON string[]
 *   GET <base>/file/<path>      → raw bytes
 *
 * readJSON parses client-side via readText.
 *
 * On a non-OK response, every method throws — including listDirectories, which
 * does NOT swallow errors as `[]`. A wrong --base must surface as an error,
 * not as "no traces found".
 *
 * @param baseUrl - URL prefix where the handler is mounted
 *                  (e.g. https://ci.example/_introspect). A trailing slash is stripped.
 */
export function createHttpReadAdapter(baseUrl: string): StorageAdapter {
  const base = baseUrl.replace(/\/$/, '')

  const adapter: StorageAdapter = {
    async listDirectories(subPath?: string) {
      const url = subPath ? `${base}/dirs/${subPath}` : `${base}/dirs/`
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`listDirectories(${JSON.stringify(subPath)}) failed: ${response.status} from ${url}`)
      }
      return response.json()
    },

    async readText(path: string) {
      const response = await fetch(`${base}/file/${path}`)
      if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status}`)
      return response.text()
    },

    async readBinary(path: string) {
      const response = await fetch(`${base}/file/${path}`)
      if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },

    async readJSON<T = unknown>(path: string): Promise<T> {
      return JSON.parse(await adapter.readText(path)) as T
    },
  }

  return adapter
}
