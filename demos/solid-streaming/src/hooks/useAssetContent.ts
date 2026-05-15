import { createSignal, createEffect, type Accessor } from 'solid-js'
import type { TraceReader, PayloadAsset } from '@introspection/types'
import { useWatchedQuery } from './useWatchedQuery.js'

export interface AssetWithContent {
  asset: PayloadAsset
  content: string | null
  loading: boolean
}

/**
 * Watches all events for asset references and fetches their text content as they arrive.
 * Only fetches content for newly added assets.
 */
export function useAssetContent(
  getTrace: Accessor<TraceReader | undefined>,
) {
  const events = useWatchedQuery(getTrace)
  const [assets, setAssets] = createSignal<AssetWithContent[]>([])
  const fetchedPaths = new Set<string>()

  createEffect(() => {
    const trace = getTrace()
    if (!trace) return

    const newAssets: PayloadAsset[] = []
    for (const event of events) {
      if (!event.payloads) continue
      for (const ref of Object.values(event.payloads)) {
        if (ref.kind !== 'asset') continue
        if (!fetchedPaths.has(ref.path)) newAssets.push(ref)
      }
    }

    if (newAssets.length === 0) return

    for (const asset of newAssets) {
      fetchedPaths.add(asset.path)

      const entry: AssetWithContent = {
        asset,
        content: null,
        loading: asset.format !== 'image',
      }

      setAssets(previous => [entry, ...previous])

      if (asset.format === 'image') continue

      trace.resolvePayload(asset).then(content => {
        setAssets(previous => previous.map(item =>
          item.asset.path === asset.path ? { ...item, content: content as string, loading: false } : item
        ))
      }).catch(() => {
        setAssets(previous => previous.map(item =>
          item.asset.path === asset.path ? { ...item, content: null, loading: false } : item
        ))
      })
    }
  })

  return assets
}
