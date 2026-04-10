import type { BaseEvent } from '@introspection/types'

export type ConsoleLevel = 'log' | 'warn' | 'error' | 'info' | 'debug'

export interface ConsoleEvent extends BaseEvent {
  type: 'console'
  data: { level: ConsoleLevel; message: string }
}

declare module '@introspection/types' {
  interface TraceEventMap {
    'console': ConsoleEvent
  }
}
