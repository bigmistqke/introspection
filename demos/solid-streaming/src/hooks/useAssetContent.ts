import { createSignal, createEffect, on, type Accessor } from 'solid-js'
import type { SessionReader, AssetEvent } from '@introspection/types'
import { useWatchedQuery } from './useWatchedQuery.js'

export interface AssetWithContent {
  event: AssetEvent
  content: string | null
  loading: boolean
}

/**
 * Watches for asset events and fetches their text content as they arrive.
 */
export function useAssetContent(
  getSession: Accessor<SessionReader | undefined>,
) {
  const assetEvents = useWatchedQuery(getSession, { type: 'asset' })
  const [assets, setAssets] = createSignal<AssetWithContent[]>([])

  createEffect(on(assetEvents, (events) => {
    const session = getSession()
    if (!session) return

    const assetList = (events as AssetEvent[]).map(event => ({
      event,
      content: null as string | null,
      loading: true,
    }))

    setAssets(assetList)

    for (let index = 0; index < assetList.length; index++) {
      const asset = assetList[index]
      if (asset.event.data.contentType === 'image') {
        setAssets(previous => previous.map((item, position) =>
          position === index ? { ...item, content: null, loading: false } : item
        ))
        continue
      }

      session.assets.readText(asset.event.data.path).then(content => {
        setAssets(previous => previous.map((item, position) =>
          position === index ? { ...item, content, loading: false } : item
        ))
      }).catch(() => {
        setAssets(previous => previous.map((item, position) =>
          position === index ? { ...item, content: null, loading: false } : item
        ))
      })
    }
  }))

  return assets
}
