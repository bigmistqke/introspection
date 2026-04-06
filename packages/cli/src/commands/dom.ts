import type { TraceFile, AssetEvent } from '@introspection/types'

export function formatDom(trace: TraceFile): string {
  const assetEvents = trace.events.filter((e): e is AssetEvent => e.type === 'asset' && e.data.kind === 'snapshot')
  const preferred = assetEvents.find(e => e.data.trigger === 'js.error') ?? assetEvents[0]
  const snapshot = preferred ? trace.snapshots?.[preferred.data.path.replace(/\.snapshot\.json$/, '')] : undefined
  if (!snapshot?.dom) return '(no DOM snapshot available)'
  return snapshot.dom
}
