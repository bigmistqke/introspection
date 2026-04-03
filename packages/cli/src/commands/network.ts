import type { TraceEvent } from '@introspection/types'

interface NetworkOpts { failed?: boolean; url?: string }

export function formatNetworkTable(events: TraceEvent[], opts: NetworkOpts): string {
  const responses = events.filter(e => e.type === 'network.response') as Array<{ data: { cdpRequestId: string; url: string; status: number; requestId: string } } & TraceEvent>
  const requests = new Map(
    (events.filter(e => e.type === 'network.request') as Array<{ id: string; data: { cdpRequestId: string; url: string; method: string } } & TraceEvent>)
      .map(e => [e.data.cdpRequestId, e])
  )

  let filtered = responses
  if (opts.failed) filtered = filtered.filter(r => r.data.status >= 400)
  if (opts.url) filtered = filtered.filter(r => r.data.url.includes(opts.url!))

  const rows = filtered.map(res => {
    const req = requests.get(res.data.cdpRequestId)
    return `${String(res.data.status).padEnd(5)} ${(req?.data.method ?? '?').padEnd(7)} ${res.data.url}`
  })

  // Collect network.error events
  const errorEvents = events.filter(e => e.type === 'network.error') as Array<{ data: { cdpRequestId?: string; url?: string; errorText: string } } & TraceEvent>
  let filteredErrors = errorEvents
  if (opts.url) filteredErrors = filteredErrors.filter(e => {
    const req = e.data.cdpRequestId ? requests.get(e.data.cdpRequestId) : undefined
    const url = req?.data.url ?? e.data.url ?? ''
    return url.includes(opts.url!)
  })
  // network.error events are always failures; include them when --failed or no filter
  const errorRows = filteredErrors.map(e => {
    const req = e.data.cdpRequestId ? requests.get(e.data.cdpRequestId) : undefined
    const method = req?.data.method ?? '?'
    const url = req?.data.url ?? e.data.url ?? '?'
    return `${'ERR'.padEnd(5)} ${method.padEnd(7)} ${url}`
  })

  const allRows = [...rows, ...errorRows]
  if (!allRows.length) return '(no matching network events)'

  return ['STATUS METHOD  URL', ...allRows].join('\n')
}
