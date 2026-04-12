import { createSignal, createEffect, type Accessor } from 'solid-js'
import type { SessionReader, AssetRef } from '@introspection/types'
import { useWatchedQuery } from './useWatchedQuery.js'

export interface AssetWithContent {
  asset: AssetRef
  content: string | null
  loading: boolean
}

/**
 * Watches all events for asset references and fetches their text content as they arrive.
 * Only fetches content for newly added assets.
 */
export function useAssetContent(
  getSession: Accessor<SessionReader | undefined>,
) {
  const events = useWatchedQuery(getSession)
  const [assets, setAssets] = createSignal<AssetWithContent[]>([])
  const fetchedPaths = new Set<string>()

  createEffect(() => {
    const session = getSession()
    if (!session) return

    const newAssets: AssetRef[] = []
    for (const event of events) {
      if (!event.assets) continue
      for (const asset of event.assets) {
        if (!fetchedPaths.has(asset.path)) newAssets.push(asset)
      }
    }

    if (newAssets.length === 0) return

    for (const asset of newAssets) {
      fetchedPaths.add(asset.path)

      const entry: AssetWithContent = {
        asset,
        content: null,
        loading: asset.kind !== 'image',
      }

      setAssets(previous => [entry, ...previous])

      if (asset.kind === 'image') continue

      session.assets.readText(asset.path).then(content => {
        setAssets(previous => previous.map(item =>
          item.asset.path === asset.path ? { ...item, content, loading: false } : item
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
