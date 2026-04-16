import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import type { SessionReader } from '@introspection/types'
import {
  type StorageAdapter,
  type SessionSummary,
  createSessionReader as createSessionReaderFromAdapter,
  listSessions as listSessionsFromAdapter,
} from './index.js'

export type { StorageAdapter, SessionSummary } from './index.js'
export type { SessionReader, EventsFilter, EventsAPI, AssetsAPI } from '@introspection/types'

export function createNodeAdapter(dir: string): StorageAdapter {
  return {
    async listDirectories() {
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
      } catch {
        return []
      }
    },
    async readText(path: string) {
      return readFile(join(dir, path), 'utf-8')
    },
    async readBinary(path: string) {
      const buffer = await readFile(join(dir, path))
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
    },
    async readJSON<T = unknown>(path: string): Promise<T> {
      const text = await readFile(join(dir, path), 'utf-8')
      return JSON.parse(text) as T
    },
  }
}

export async function createSessionReader(dir: string, options?: { sessionId?: string; verbose?: boolean }): Promise<SessionReader> {
  return createSessionReaderFromAdapter(createNodeAdapter(dir), options)
}

export async function listSessions(dir: string): Promise<SessionSummary[]> {
  return listSessionsFromAdapter(createNodeAdapter(dir))
}
