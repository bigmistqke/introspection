import type { StorageAdapter } from '@introspection/types'

export interface MemoryWriteAdapter extends StorageAdapter {
  writeText(path: string, content: string): Promise<void>
  appendText(path: string, content: string): Promise<void>
  writeBinary?(path: string, content: ArrayBuffer): Promise<void>
  writeAsset(path: string, content: string | ArrayBuffer): Promise<void>
}

export function createMemoryAdapters(
  store?: Map<string, string | ArrayBuffer>
): {
  reader: StorageAdapter
  write: MemoryWriteAdapter
} {
  const files = store ?? new Map<string, string | ArrayBuffer>()

  const reader: StorageAdapter = {
    async listDirectories() {
      const dirs = new Set<string>()
      for (const path of files.keys()) {
        const dir = path.split('/')[0]!
        if (dir) dirs.add(dir)
      }
      return Array.from(dirs)
    },
    async readText(path: string) {
      const content = files.get(path)
      if (content === undefined) throw new Error(`File not found: ${path}`)
      if (typeof content !== 'string') throw new Error(`Not a text file: ${path}`)
      return content
    },
    async readBinary(path: string) {
      const content = files.get(path)
      if (content === undefined) throw new Error(`File not found: ${path}`)
      if (typeof content === 'string') throw new Error(`Not a binary file: ${path}`)
      return content
    },
  }

  const write: MemoryWriteAdapter = {
    ...reader,
    async writeText(path: string, content: string) {
      files.set(path, content)
    },
    async appendText(path: string, content: string) {
      const existing = files.get(path)
      if (existing === undefined || typeof existing !== 'string') {
        files.set(path, content)
      } else {
        files.set(path, existing + content)
      }
    },
    async writeBinary(path: string, content: ArrayBuffer) {
      files.set(path, content)
    },
    async writeAsset(path: string, content: string | ArrayBuffer) {
      files.set(path, content)
    },
  }

  return { reader, write }
}
