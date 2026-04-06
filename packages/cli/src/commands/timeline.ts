import type { TraceFile } from '@introspection/types'

export function formatTimeline(trace: TraceFile, opts?: { type?: string; source?: string }): string {
  let events = trace.events
  if (opts?.type) events = events.filter(event => event.type === opts.type)
  if (opts?.source) events = events.filter(event => event.source === opts.source)
  return events.map(event => {
    const timestampStr = String(event.timestamp).padStart(6) + 'ms'
    const src = event.source.padEnd(10)
    let detail = event.type
    if (event.type === 'network.request') detail += ` ${event.data.method} ${event.data.url}`
    else if (event.type === 'network.response') detail += ` ${event.data.status} ${event.data.url}`
    else if (event.type === 'js.error') detail += ` ${event.data.message}`
    else if (event.type === 'mark') detail += ` "${event.data.label}"`
    else if (event.type === 'playwright.action') detail += ` ${event.data.method}(${event.data.args[0] ?? ''})`
    else if (event.type === 'asset') detail += ` ${event.data.kind} ${event.data.path}`
    return `[${timestampStr}] ${src} ${detail}`
  }).join('\n')
}
