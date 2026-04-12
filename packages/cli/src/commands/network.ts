import type { TraceEvent } from '../types.js'

interface NetworkOpts { failed?: boolean; url?: string }

export function formatNetworkTable(events: TraceEvent[], opts: NetworkOpts): string {
  const responses = events.filter((event): event is TraceEvent & { type: 'network.response' } => event.type === 'network.response')
  const requests = new Map(
    events.filter((event): event is TraceEvent & { type: 'network.request' } => event.type === 'network.request')
      .map(event => [event.metadata.cdpRequestId, event])
  )

  let filtered = responses
  if (opts.failed) filtered = filtered.filter(response => response.metadata.status >= 400)
  if (opts.url) filtered = filtered.filter(response => response.metadata.url.includes(opts.url!))

  const rows = filtered.map(response => {
    const request = requests.get(response.metadata.cdpRequestId)
    return `${String(response.metadata.status).padEnd(5)} ${(request?.metadata.method ?? '?').padEnd(7)} ${response.metadata.url.padEnd(60)} ${response.id}`
  })

  // Collect network.error events
  const errorEvents = events.filter((event): event is TraceEvent & { type: 'network.error' } => event.type === 'network.error')
  let filteredErrors = errorEvents
  if (opts.url) filteredErrors = filteredErrors.filter(event => {
    return event.metadata.url.includes(opts.url!)
  })
  const errorRows = filteredErrors.map(event => {
    const request = event.metadata.cdpRequestId ? requests.get(event.metadata.cdpRequestId) : undefined
    const method = request?.metadata.method ?? '?'
    return `${'ERR'.padEnd(5)} ${method.padEnd(7)} ${event.metadata.url.padEnd(60)} ${event.id}`
  })

  const allRows = [...rows, ...errorRows]
  if (!allRows.length) return '(no matching network events)'

  return ['STATUS METHOD  URL' + ' '.repeat(43) + 'EVENT_ID', ...allRows].join('\n')
}
