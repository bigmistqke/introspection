import type { BaseEvent, StackFrame } from '@introspection/types'

export interface JsErrorEvent extends BaseEvent {
  type: 'js.error'
  data: { message: string; stack: StackFrame[] }
}

declare module '@introspection/types' {
  interface TraceEventMap {
    'js.error': JsErrorEvent
  }
}
