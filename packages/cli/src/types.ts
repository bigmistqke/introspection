// Import all plugin type augmentations so TraceEvent includes all event types.
// The CLI is a leaf consumer that reads traces from any plugin.
import type {} from '@introspection/plugin-network'
import type {} from '@introspection/plugin-js-error'
import type {} from '@introspection/plugin-console'

export type { TraceEvent, TraceFile, AssetEvent, SessionMeta } from '@introspection/types'
