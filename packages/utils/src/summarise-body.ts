import type { BodySummary } from '@introspection/types'

export function summariseBody(raw: string): BodySummary {
  let parsed: Record<string, unknown>
  try {
    const body = JSON.parse(raw)
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return { keys: [], scalars: {}, arrays: {}, errorFields: {} }
    }
    parsed = body
  } catch { return { keys: [], scalars: {}, arrays: {}, errorFields: {} } }

  const keys = Object.keys(parsed)
  const scalars: Record<string, string | number | boolean | null> = {}
  const arrays: Record<string, { length: number; itemKeys: string[] }> = {}
  const errorFields: Record<string, unknown> = {}
  const ERROR_KEYS = new Set(['error', 'message', 'code', 'status', 'detail'])

  for (const [k, v] of Object.entries(parsed)) {
    if (Array.isArray(v)) {
      const first = v[0] && typeof v[0] === 'object' ? Object.keys(v[0] as object) : []
      arrays[k] = { length: v.length, itemKeys: first }
    } else if (typeof v !== 'object' || v === null) {
      scalars[k] = v as string | number | boolean | null
    }
    if (ERROR_KEYS.has(k)) errorFields[k] = v
  }
  return { keys, scalars, arrays, errorFields }
}
