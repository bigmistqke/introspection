import jsonpatch from 'fast-json-patch'
import type { TraceEvent, AssetsAPI, ReduxDispatchEvent } from '@introspection/types'

export class ReduxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReduxError'
  }
}

export async function reconstruct(opts: {
  events: TraceEvent[]
  assets: AssetsAPI
  eventId: string
}): Promise<{ beforeState: unknown; afterState: unknown }> {
  const { events, assets, eventId } = opts

  const targetEvent = events.find(e => e.id === eventId)
  if (!targetEvent) {
    throw new ReduxError(`Event ${eventId} not found`)
  }

  const targetEventIdx = events.findIndex(e => e.id === eventId)
  if (targetEventIdx === -1) {
    throw new ReduxError(`Event ${eventId} not found`)
  }

  let snapshotIndex = -1
  for (let i = targetEventIdx - 1; i >= 0; i--) {
    if (events[i].type === 'redux.snapshot') {
      snapshotIndex = i
      break
    }
  }
  if (snapshotIndex === -1) {
    throw new ReduxError(`No redux.snapshot found before event ${eventId}`)
  }

  const snapshot = events[snapshotIndex] as Extract<TraceEvent, { type: 'redux.snapshot' }>
  const snapshotState = await assets.readJSON(snapshot.assets[0].path)

  let state = snapshotState

  for (let i = snapshotIndex + 1; i < targetEventIdx; i++) {
    const event = events[i]
    if (event.type === 'redux.dispatch') {
      const dispatch = event as ReduxDispatchEvent
      if (dispatch.metadata.diff && dispatch.metadata.diff.length > 0) {
        const result = jsonpatch.applyPatch(state, dispatch.metadata.diff as jsonpatch.Operation[], true, false)
        state = result.newDocument
      }
    }
  }

  const isDispatch = targetEvent.type === 'redux.dispatch'
  const dispatch = targetEvent as ReduxDispatchEvent

  if (isDispatch && dispatch.metadata.diff && dispatch.metadata.diff.length > 0) {
    const result = jsonpatch.applyPatch(
      jsonpatch.deepClone(state),
      dispatch.metadata.diff as jsonpatch.Operation[],
      true,
      false
    )
    return { beforeState: state, afterState: result.newDocument }
  }

  return { beforeState: state, afterState: state }
}