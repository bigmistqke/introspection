import { JSONPath } from 'jsonpath-plus'

interface BodyOpts { path?: string }

export function queryBody(raw: string, opts: BodyOpts): string {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return raw }

  if (!opts.path) return JSON.stringify(parsed, null, 2)

  // Normalise path: jsonpath-plus requires a $ root; accept bare dotted paths like ".errors"
  const normPath = opts.path.startsWith('$') ? opts.path : `$${opts.path}`
  const results = JSONPath({ path: normPath, json: parsed as object })
  if (!results || (Array.isArray(results) && results.length === 0)) return '(no match for path)'
  return JSON.stringify(Array.isArray(results) && results.length === 1 ? results[0] : results, null, 2)
}
