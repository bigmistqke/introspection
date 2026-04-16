import type { StorageAdapter } from '@introspection/types'

export interface MemoryWriteAdapter extends StorageAdapter {
  writeText(path: string, content: string): Promise<void>
  appendText(path: string, content: string): Promise<void>
  writeBinary?(path: string, content: ArrayBufferView): Promise<void>
  writeAsset(path: string, content: string | ArrayBufferView): Promise<void>
}

function snapshotBytes(view: ArrayBufferView): Uint8Array {
  const copy = new Uint8Array(view.byteLength)
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  return copy
}

export function createMemoryWriteAdapter(
  store: Map<string, string | Uint8Array> = new Map()
): MemoryWriteAdapter {
  return {
    async listDirectories() {
      const dirs = new Set<string>()
      for (const path of store.keys()) {
        const dir = path.split('/')[0]!
        if (dir) dirs.add(dir)
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
    async writeText(path: string, content: string) {
      store.set(path, content)
    },
    async appendText(path: string, content: string) {
      const existing = store.get(path)
      if (existing === undefined || typeof existing !== 'string') {
        store.set(path, content)
      } else {
        store.set(path, existing + content)
      }
    },
    async writeBinary(path: string, content: ArrayBufferView) {
      store.set(path, snapshotBytes(content))
    },
    async writeAsset(path: string, content: string | ArrayBufferView) {
      store.set(path, typeof content === 'string' ? content : snapshotBytes(content))
    },
  }
}
