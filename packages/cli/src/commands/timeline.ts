import type { TraceFile } from '@introspection/types'

export function formatTimeline(trace: TraceFile): string {
  return trace.events.map(e => {
    const ts = String(e.ts).padStart(6) + 'ms'
    const src = e.source.padEnd(10)
    let detail = e.type
    if (e.type === 'network.request') detail += ` ${e.data.method} ${e.data.url}`
    else if (e.type === 'network.response') detail += ` ${e.data.status} ${e.data.url}`
    else if (e.type === 'js.error') detail += ` ${e.data.message}`
    else if (e.type === 'mark') detail += ` "${e.data.label}"`
    else if (e.type === 'playwright.action') detail += ` ${e.data.method}(${e.data.args[0] ?? ''})`
    return `[${ts}] ${src} ${detail}`
  }).join('\n')
}
