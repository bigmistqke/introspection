import type { StorageAdapter } from '@introspection/types'

export function createMemoryReadAdapter(
  store: Map<string, string | Uint8Array>
): StorageAdapter {
  return {
    async listDirectories(subPath?: string) {
      const prefix = subPath ? `${subPath.replace(/\/$/, '')}/` : ''
      const dirs = new Set<string>()
      for (const path of store.keys()) {
        if (prefix && !path.startsWith(prefix)) continue
        const rest = path.slice(prefix.length)
        const segment = rest.split('/')[0]
        // a segment is a directory only if there is a path component after it
        if (segment && rest.includes('/')) dirs.add(segment)
      }
      return Array.from(dirs)
    },
    async readText(path: string) {
      const content = store.get(path)
      if (content === undefined) throw new Error(`File not found: ${path}`)
      if (typeof content !== 'string') throw new Error(`Not a text file: ${path}`)
      return content
    },
    async readBinary(path: string) {
      const content = store.get(path)
      if (content === undefined) throw new Error(`File not found: ${path}`)
      if (typeof content === 'string') throw new Error(`Not a binary file: ${path}`)
      return content
    },
    async readJSON<T = unknown>(path: string): Promise<T> {
      const content = store.get(path)
      if (content === undefined) throw new Error(`File not found: ${path}`)
      if (typeof content !== 'string') throw new Error(`Not a text file: ${path}`)
      return JSON.parse(content) as T
    },
  }
}
