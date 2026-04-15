export interface ServeOptions {
  directory: string
  prefix?: string
  streaming?: boolean
}

export interface NodeServeOptions extends ServeOptions {
  port: number
  host?: string
}

export interface SessionMeta {
  id: string
  label?: string
  startedAt?: number
}

export interface ErrorResponse {
  error: string
}