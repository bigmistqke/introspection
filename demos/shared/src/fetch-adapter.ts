import type { StorageAdapter } from '@introspection/read'

/**
 * Creates a StorageAdapter that fetches data over HTTP from a server that
 * exposes the @introspection/serve protocol:
 *
 *   GET <baseUrl>/dirs/<subPath?>  → JSON string[]
 *   GET <baseUrl>/file/<path>      → raw bytes
 *
 * `readJSON` parses client-side via `readText`, so the server never has to
 * know which extensions are JSON.
 *
 * @param baseUrl - URL prefix where the handler is mounted (e.g. `/_introspect`).
 */
export function createFetchAdapter(baseUrl: string): StorageAdapter {
  const base = baseUrl.replace(/\/$/, '')

  const adapter: StorageAdapter = {
    async listDirectories(subPath?: string) {
      const url = subPath ? `${base}/dirs/${subPath}` : `${base}/dirs/`
      const response = await fetch(url)
      if (!response.ok) return []
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
