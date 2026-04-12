export type { SolidDevtoolsDetectedEvent, SolidDevtoolsWarningEvent } from '@introspection/types'

declare global {
  interface Window {
    __introspect_plugins__?: Record<string, unknown>
  }
}

export type SolidCaptureMode = 'stream' | 'trigger' | 'off'

export interface SolidDevtoolsOptions {
  verbose?: boolean
  structureUpdates?: SolidCaptureMode
  nodeUpdates?: SolidCaptureMode
  dependencyGraph?: SolidCaptureMode
}

export interface SolidState {
  structure: unknown | null
  updates: unknown | null
  dgraph: unknown | null
}
