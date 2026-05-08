import { runInNewContext } from 'vm'
import type { TraceEvent } from '../types.js'
import { matchEventType } from '@introspection/read'

export interface EventFilterOpts {
  type?: string
  after?: number
  before?: number
  since?: string
  last?: number
  filter?: string
  format?: 'text' | 'json'
}

export function applyEventFilters(events: TraceEvent[], opts: EventFilterOpts): TraceEvent[] {
  if (opts.last !== undefined && (!Number.isInteger(opts.last) || opts.last < 1)) {
    throw new Error('--last must be a positive integer')
  }

  let lowerBound = opts.after ?? -Infinity
  if (opts.since !== undefined) {
    const mark = events.find(
      event => event.type === 'mark' && (event.metadata as { label: string }).label === opts.since
    )
    if (!mark) throw new Error(`no mark event with label "${opts.since}" found`)
    lowerBound = Math.max(lowerBound, mark.timestamp)
  }

  const patterns = opts.type ? opts.type.split(',').map(type => type.trim()).filter(Boolean) : null

  let result = events.filter(event => {
    if (patterns && !patterns.some(pattern => matchEventType(pattern, event.type))) return false
    if (event.timestamp <= lowerBound) return false
    if (opts.before !== undefined && event.timestamp >= opts.before) return false
    return true
  })

  if (opts.last !== undefined) result = result.slice(-opts.last)
  return result
}

export function formatTimeline(events: TraceEvent[]): string {
  return events.map(event => {
    const timestampStr = String(event.timestamp).padStart(6) + 'ms'
    let detail = event.summary ? `${event.type} ${event.summary}` : event.type
    if (event.payloads) {
      const entries = Object.entries(event.payloads)
      if (entries.length > 0) {
        detail += ` [${entries.map(([name, ref]) => {
          if (ref.kind === 'inline') return `${name}:inline`
          return `${name}:${ref.format}:${ref.path}`
        }).join(', ')}]`
      }
    }
    return `[${timestampStr}] ${detail}`
  }).join('\n')
}

export function formatEvents(events: TraceEvent[], opts: EventFilterOpts): string {
  let filtered = applyEventFilters(events, opts)

  if (opts.filter) {
    filtered = filtered.filter(event => {
      try {
        return Boolean(runInNewContext(opts.filter!, { event }))
      } catch {
        return false
      }
    })
  }

  if (opts.format === 'json') {
    return JSON.stringify(filtered, null, 2)
  }

  return formatTimeline(filtered)
}
