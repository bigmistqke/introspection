import { randomBytes } from 'crypto'

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

function timestamp(date = new Date()): string {
  const y = date.getFullYear()
  const mo = pad(date.getMonth() + 1, 2)
  const d = pad(date.getDate(), 2)
  const h = pad(date.getHours(), 2)
  const mi = pad(date.getMinutes(), 2)
  const s = pad(date.getSeconds(), 2)
  return `${y}${mo}${d}-${h}${mi}${s}`
}

/**
 * The run directory name. `INTROSPECT_RUN_ID` (set by CI to e.g.
 * `<branch>_<pipeline>`) wins; otherwise `<YYYYMMDD-HHmmss>-<random>`.
 */
export function resolveRunId(env: NodeJS.ProcessEnv = process.env): string {
  const provided = env.INTROSPECT_RUN_ID
  if (provided && provided.length > 0) return provided
  return `${timestamp()}-${randomBytes(2).toString('hex')}`
}
