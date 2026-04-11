import type { StorageAdapter } from '@introspection/read'

/**
 * Creates a StorageAdapter that fetches session data over HTTP.
 *
 * @param baseUrl - URL prefix where sessions are served (e.g. `/__introspect`)
 */
export function createFetchAdapter(baseUrl: string): StorageAdapter {
  const base = baseUrl.replace(/\/$/, '')

  return {
    async listDirectories() {
      const response = await fetch(`${base}/`)
      if (!response.ok) return []
      return response.json()
    },

    async readText(path: string) {
      const response = await fetch(`${base}/${path}`)
      if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status}`)
      return response.text()
    },

    async fileSize(path: string) {
      const response = await fetch(`${base}/${path}`, { method: 'HEAD' })
      if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status}`)
      return Number(response.headers.get('content-length') ?? 0)
    },
  }
}
