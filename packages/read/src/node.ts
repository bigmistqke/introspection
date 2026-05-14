import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import type { SessionReader } from '@introspection/types'
import {
  type StorageAdapter,
  type SessionSummary,
  type RunSummary,
  createSessionReader as createSessionReaderFromAdapter,
  listRuns as listRunsFromAdapter,
  listSessions as listSessionsFromAdapter,
} from './index.js'

export type { StorageAdapter, SessionSummary, RunSummary } from './index.js'
export type { SessionReader, EventsFilter, EventsAPI } from '@introspection/types'

export function createNodeAdapter(dir: string): StorageAdapter {
  return {
    async listDirectories(subPath?: string) {
      const target = subPath ? join(dir, subPath) : dir
      try {
        const entries = await readdir(target, { withFileTypes: true })
        return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
      } catch {
        return []
      }
    },
    async readText(path: string) {
      return readFile(join(dir, path), 'utf-8')
    },
    async readBinary(path: string) {
      return readFile(join(dir, path))
    },
    async readJSON<T = unknown>(path: string): Promise<T> {
      const text = await readFile(join(dir, path), 'utf-8')
      return JSON.parse(text) as T
    },
  }
}

export async function createSessionReader(
  dir: string,
  options?: { runId?: string; sessionId?: string; verbose?: boolean },
): Promise<SessionReader> {
  return createSessionReaderFromAdapter(createNodeAdapter(dir), options)
}

export async function listRuns(dir: string): Promise<RunSummary[]> {
  return listRunsFromAdapter(createNodeAdapter(dir))
}

export async function listSessions(dir: string, runId: string): Promise<SessionSummary[]> {
  return listSessionsFromAdapter(createNodeAdapter(dir), runId)
}
