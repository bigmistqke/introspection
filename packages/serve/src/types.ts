import type { StorageAdapter } from '@introspection/types'

export interface ServeOptions {
  adapter: StorageAdapter
  prefix?: string
}

export interface NodeServeOptions {
  directory: string
  port: number
  host?: string
  prefix?: string
}

export interface ErrorResponse {
  error: string
}
