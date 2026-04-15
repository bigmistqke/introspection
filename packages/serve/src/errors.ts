import type { ErrorResponse } from './types.js'

export const ERROR_SESSION_NOT_FOUND: ErrorResponse = { error: 'Session not found' }
export const ERROR_ASSET_NOT_FOUND: ErrorResponse = { error: 'Asset not found' }
export const ERROR_STREAMING_NOT_ENABLED: ErrorResponse = { 
  error: 'Streaming not enabled. Set streaming: true in options.' 
}

export function errorResponse(status: number, body: ErrorResponse): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}