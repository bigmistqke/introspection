import { JSONPath } from 'jsonpath-plus'

interface BodyOpts { path?: string }

export function queryBody(raw: string, opts: BodyOpts): string {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return raw }

  if (!opts.path) return JSON.stringify(parsed, null, 2)

  const results = JSONPath({ path: opts.path, json: parsed as never })
  if (!results || (Array.isArray(results) && results.length === 0)) return '(no match for path)'
  return JSON.stringify(Array.isArray(results) && results.length === 1 ? results[0] : results, null, 2)
}
