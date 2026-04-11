import type { BaseEvent } from '@introspection/types'

export interface SolidDetectedEvent extends BaseEvent {
  type: 'solid.detected'
  data: Record<string, never>
}

export interface SolidWarningEvent extends BaseEvent {
  type: 'solid.warning'
  data: { message: string }
}

declare module '@introspection/types' {
  interface TraceEventMap {
    'solid.detected': SolidDetectedEvent
    'solid.warning': SolidWarningEvent
  }
}
