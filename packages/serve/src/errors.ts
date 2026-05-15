import type { ErrorResponse } from './types.js'

export function errorResponse(status: number, body: ErrorResponse): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
