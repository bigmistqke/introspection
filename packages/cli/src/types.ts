// Import plugin event type augmentations so TraceEvent includes all event types.
// The CLI is a leaf consumer that reads traces from any plugin.
import '@introspection/plugin-network/event-types'
import '@introspection/plugin-js-error/event-types'
import '@introspection/plugin-console/event-types'

export type { TraceEvent, TraceFile, AssetEvent, SessionMeta } from '@introspection/types'
