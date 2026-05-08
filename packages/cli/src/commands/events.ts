import { runInNewContext } from 'vm'
import type { TraceEvent } from '../types.js'
import type { PayloadRef } from '@introspection/types'
import { matchEventType } from '@introspection/read'

interface PayloadResolver {
  resolvePayload(ref: PayloadRef): Promise<unknown>
}

const BINARY_FORMATS = new Set(['image', 'binary'])

export interface EventFilterOpts {
  type?: string
  after?: number
  before?: number
  since?: string
  last?: number
  filter?: string
  format?: 'text' | 'json'
  payload?: string[]
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

function shouldResolveValues(opts: EventFilterOpts): boolean {
  return opts.format === 'json' || Boolean(opts.filter)
}

async function resolveEventPayloads(
  event: TraceEvent,
  reader: PayloadResolver,
  opts: EventFilterOpts,
): Promise<TraceEvent> {
  if (!event.payloads) return event
  const wantedNames = opts.payload && opts.payload.length > 0 ? new Set(opts.payload) : null
  const resolveValues = shouldResolveValues(opts)
  const resolved: Record<string, PayloadRef & { value?: unknown }> = {}

  for (const [name, ref] of Object.entries(event.payloads)) {
    if (wantedNames && !wantedNames.has(name)) continue

    if (ref.kind === 'inline') {
      resolved[name] = ref
      continue
    }
    if (!resolveValues) {
      resolved[name] = ref
      continue
    }
    if (BINARY_FORMATS.has(ref.format)) {
      resolved[name] = ref
      continue
    }
    try {
      const value = await reader.resolvePayload(ref)
      resolved[name] = { ...ref, value }
    } catch (err) {
      console.error(`[introspect] could not resolve payload '${name}' at ${ref.path}: ${(err as Error).message}`)
      resolved[name] = { ...ref, value: undefined }
    }
  }
  return { ...event, payloads: resolved } as TraceEvent
}

export async function formatEvents(
  events: TraceEvent[],
  opts: EventFilterOpts,
  reader: PayloadResolver,
): Promise<string> {
  let filtered = applyEventFilters(events, opts)
  filtered = await Promise.all(filtered.map(event => resolveEventPayloads(event, reader, opts)))

  if (opts.filter) {
    filtered = filtered.filter(event => {
      try {
        return Boolean(runInNewContext(opts.filter!, { event }))
      } catch (err) {
        console.error(`[introspect] filter error on event ${event.id}: ${(err as Error).message}`)
        return false
      }
    })
  }

  if (opts.format === 'json') return JSON.stringify(filtered, null, 2)
  return formatTimeline(filtered)
}

export function formatTimeline(events: TraceEvent[]): string {
  return events.map(event => {
    const timestampStr = String(event.timestamp).padStart(6) + 'ms'
    const header = event.summary ? `${event.type} ${event.summary}` : event.type
    const lines = [`[${timestampStr}] ${event.id} ${header}`]
    if (event.payloads) {
      for (const [name, ref] of Object.entries(event.payloads)) {
        lines.push(`  ${name}: ${formatPayloadSummary(ref)}`)
      }
    }
    return lines.join('\n')
  }).join('\n')
}

function formatPayloadSummary(ref: PayloadRef): string {
  if (ref.kind === 'inline') {
    const bytes = JSON.stringify(ref.value).length
    return `<inline ${(bytes / 1024).toFixed(1)}KB>`
  }
  const kb = ((ref.size ?? 0) / 1024).toFixed(1)
  if (BINARY_FORMATS.has(ref.format)) return `<binary, ${kb}KB, ${ref.path}>`
  return `${ref.format}, ${kb}KB`
}
