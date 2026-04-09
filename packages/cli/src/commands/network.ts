import type { TraceEvent } from '../types.js'

interface NetworkOpts { failed?: boolean; url?: string }

export function formatNetworkTable(events: TraceEvent[], opts: NetworkOpts): string {
  const responses = events.filter(event => event.type === 'network.response') as Array<{ data: { cdpRequestId: string; url: string; status: number; requestId: string } } & TraceEvent>
  const requests = new Map(
    (events.filter(event => event.type === 'network.request') as Array<{ id: string; data: { cdpRequestId: string; url: string; method: string } } & TraceEvent>)
      .map(event => [event.data.cdpRequestId, event])
  )

  let filtered = responses
  if (opts.failed) filtered = filtered.filter(response => response.data.status >= 400)
  if (opts.url) filtered = filtered.filter(response => response.data.url.includes(opts.url!))

  const rows = filtered.map(response => {
    const request = requests.get(response.data.cdpRequestId)
    return `${String(response.data.status).padEnd(5)} ${(request?.data.method ?? '?').padEnd(7)} ${response.data.url.padEnd(60)} ${response.id}`
  })

  // Collect network.error events
  const errorEvents = events.filter(event => event.type === 'network.error') as Array<{ data: { cdpRequestId?: string; url?: string; errorText: string } } & TraceEvent>
  let filteredErrors = errorEvents
  if (opts.url) filteredErrors = filteredErrors.filter(event => {
    const request = event.data.cdpRequestId ? requests.get(event.data.cdpRequestId) : undefined
    const url = request?.data.url ?? event.data.url ?? ''
    return url.includes(opts.url!)
  })
  // network.error events are always failures; include them when --failed or no filter
  const errorRows = filteredErrors.map(event => {
    const request = event.data.cdpRequestId ? requests.get(event.data.cdpRequestId) : undefined
    const method = request?.data.method ?? '?'
    const url = request?.data.url ?? event.data.url ?? '?'
    return `${'ERR'.padEnd(5)} ${method.padEnd(7)} ${url.padEnd(60)} ${event.id}`
  })

  const allRows = [...rows, ...errorRows]
  if (!allRows.length) return '(no matching network events)'

  return ['STATUS METHOD  URL' + ' '.repeat(43) + 'EVENT_ID', ...allRows].join('\n')
}
