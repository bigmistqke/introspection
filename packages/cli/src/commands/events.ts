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
    let detail = event.type
    if (event.type === 'network.request') detail += ` ${(event.metadata as { method: string }).method} ${(event.metadata as { url: string }).url}`
    else if (event.type === 'network.response') detail += ` ${(event.metadata as { status: number }).status} ${(event.metadata as { url: string }).url}`
    else if (event.type === 'js.error') detail += ` ${(event.metadata as { message: string }).message}`
    else if (event.type === 'mark') detail += ` "${(event.metadata as { label: string }).label}"`
    else if (event.type === 'playwright.action') detail += ` ${(event.metadata as { method: string }).method}(${(event.metadata as { args: unknown[] }).args[0] ?? ''})`
    else if (event.type === 'console') detail += ` [${(event.metadata as { level: string }).level}] ${(event.metadata as { message: string }).message}`
    else if (event.type === 'browser.navigate') detail += ` ${(event.metadata as { from: string }).from} → ${(event.metadata as { to: string }).to}`
    if (event.assets && event.assets.length > 0) {
      detail += ` [${event.assets.map(asset => `${asset.kind}:${asset.path}`).join(', ')}]`
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
