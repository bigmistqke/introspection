import type { TraceEvent } from '@introspection/types'

interface NetworkOpts { failed?: boolean; url?: string }

export function formatNetworkTable(events: TraceEvent[], opts: NetworkOpts): string {
  const responses = events.filter(e => e.type === 'network.response') as Array<{ data: { url: string; status: number; requestId: string } } & TraceEvent>
  const requests = new Map(
    (events.filter(e => e.type === 'network.request') as Array<{ id: string; data: { url: string; method: string } } & TraceEvent>)
      .map(e => [e.id, e])
  )

  let filtered = responses
  if (opts.failed) filtered = filtered.filter(r => r.data.status >= 400)
  if (opts.url) filtered = filtered.filter(r => r.data.url.includes(opts.url!))

  if (!filtered.length) return '(no matching network events)'

  const rows = filtered.map(res => {
    const req = requests.get(res.data.requestId)
    return `${String(res.data.status).padEnd(5)} ${(req?.data.method ?? '?').padEnd(7)} ${res.data.url}`
  })

  return ['STATUS METHOD  URL', ...rows].join('\n')
}
