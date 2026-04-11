import { readdir, readFile, stat } from 'fs/promises'
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
    async fileSize(path: string) {
      const fileStat = await stat(join(dir, path))
      return fileStat.size
    },
  }
}

export async function createSessionReader(dir: string, sessionId?: string): Promise<SessionReader> {
  return createSessionReaderFromAdapter(createNodeAdapter(dir), sessionId)
}

export async function listSessions(dir: string): Promise<SessionSummary[]> {
  return listSessionsFromAdapter(createNodeAdapter(dir))
}
