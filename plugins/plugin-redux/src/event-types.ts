import type { BaseEvent } from '@introspection/types'

export interface ReduxDispatchEvent extends BaseEvent {
  type: 'redux.dispatch'
  data: { action: string; payload?: unknown; stateBefore?: unknown; stateAfter?: unknown }
}

declare module '@introspection/types' {
  interface TraceEventMap {
    'redux.dispatch': ReduxDispatchEvent
  }
}
