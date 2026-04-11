import '@introspection/plugin-js-error/event-types'
import './event-types.js'

export type { SolidDetectedEvent, SolidWarningEvent } from './event-types.js'

declare global {
  interface Window {
    __introspect_plugins__?: Record<string, unknown>
  }
}

export type SolidCaptureMode = 'stream' | 'trigger' | 'off'

export interface SolidDevtoolsOptions {
  structureUpdates?: SolidCaptureMode
  nodeUpdates?: SolidCaptureMode
  dependencyGraph?: SolidCaptureMode
}

export interface SolidState {
  structure: unknown | null
  updates: unknown | null
  dgraph: unknown | null
}
