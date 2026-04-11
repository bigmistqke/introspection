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
 * Only fetches content for newly added assets.
 */
export function useAssetContent(
  getSession: Accessor<SessionReader | undefined>,
) {
  const assetEvents = useWatchedQuery(getSession, { type: 'asset' })
  const [assets, setAssets] = createSignal<AssetWithContent[]>([])
  const fetchedPaths = new Set<string>()

  createEffect(on(assetEvents, (events) => {
    const session = getSession()
    if (!session) return

    const typedEvents = events as AssetEvent[]
    const newEvents = typedEvents.filter(event => !fetchedPaths.has(event.data.path))

    if (newEvents.length === 0) return

    for (const event of newEvents) {
      fetchedPaths.add(event.data.path)

      const entry: AssetWithContent = {
        event,
        content: null,
        loading: event.data.contentType !== 'image',
      }

      setAssets(previous => [entry, ...previous])

      if (event.data.contentType === 'image') continue

      session.assets.readText(event.data.path).then(content => {
        setAssets(previous => previous.map(item =>
          item.event.id === event.id ? { ...item, content, loading: false } : item
        ))
      }).catch(() => {
        setAssets(previous => previous.map(item =>
          item.event.id === event.id ? { ...item, content: null, loading: false } : item
        ))
      })
    }
  }))

  return assets
}
