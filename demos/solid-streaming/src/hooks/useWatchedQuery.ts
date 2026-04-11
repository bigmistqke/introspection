import { createSignal, onCleanup, createEffect, on, type Accessor } from 'solid-js'
import type { TraceEvent, SessionReader, EventsFilter } from '@introspection/types'

/**
 * Bridges a SessionReader's query.watch() AsyncIterable into a Solid signal.
 * Re-subscribes when the session accessor changes.
 */
export function useWatchedQuery(
  getSession: Accessor<SessionReader | undefined>,
  filter?: EventsFilter,
) {
  const [events, setEvents] = createSignal<TraceEvent[]>([])

  createEffect(on(getSession, (session) => {
    if (!session) {
      setEvents([])
      return
    }

    const iterable = filter
      ? session.events.query.watch(filter)
      : session.events.ls.watch()

    const iterator = iterable[Symbol.asyncIterator]()
    let stopped = false

    async function consume() {
      while (!stopped) {
        const result = await iterator.next()
        if (result.done) break
        setEvents(result.value)
      }
    }
    consume()

    onCleanup(() => {
      stopped = true
      iterator.return?.()
    })
  }))

  return events
}
