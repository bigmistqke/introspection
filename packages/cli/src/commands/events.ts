import { runInNewContext } from 'vm'
import type { TraceFile, TraceEvent } from '@introspection/types'
import { formatTimeline } from './timeline.js'

const VALID_SOURCES = new Set(['cdp', 'agent', 'playwright'])

export interface EventFilterOpts {
  type?: string
  source?: string
  after?: number
  before?: number
  since?: string
  last?: number
}

export function applyEventFilters(trace: TraceFile, opts: EventFilterOpts): TraceEvent[] {
  if (opts.source !== undefined && !VALID_SOURCES.has(opts.source)) {
    throw new Error(`unknown source "${opts.source}". Valid values: cdp, agent, playwright`)
  }
  if (opts.last !== undefined && (!Number.isInteger(opts.last) || opts.last < 1)) {
    throw new Error('--last must be a positive integer')
  }

  // Resolve --since against the full unfiltered event list before any other filtering
  let lowerBound = opts.after ?? -Infinity
  if (opts.since !== undefined) {
    const mark = trace.events.find(
      e => e.type === 'mark' && (e.data as { label: string }).label === opts.since
    )
    if (!mark) throw new Error(`no mark event with label "${opts.since}" found`)
    lowerBound = Math.max(lowerBound, mark.ts)
  }

  const types = opts.type ? opts.type.split(',').map(s => s.trim()).filter(Boolean) : null

  let result = trace.events.filter(e => {
    if (types && !types.includes(e.type)) return false
    if (opts.source && e.source !== opts.source) return false
    if (e.ts <= lowerBound) return false
    if (opts.before !== undefined && e.ts >= opts.before) return false
    return true
  })

  if (opts.last !== undefined) result = result.slice(-opts.last)
  return result
}

export function formatEvents(trace: TraceFile, opts: EventFilterOpts, expression?: string): string {
  const filtered = applyEventFilters(trace, opts)

  if (!expression) {
    return formatTimeline({ ...trace, events: filtered })
  }

  const results = filtered.map(ev => {
    try {
      const raw = runInNewContext(expression, { event: ev })
      return raw === undefined ? null : raw
    } catch (err) {
      return { error: String(err), event: ev }
    }
  })
  return JSON.stringify(results, null, 2)
}
