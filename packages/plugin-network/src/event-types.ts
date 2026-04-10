import type { BaseEvent, BodySummary } from '@introspection/types'

export interface NetworkRequestEvent extends BaseEvent {
  type: 'network.request'
  data: { cdpRequestId: string; url: string; method: string; headers: Record<string, string>; postData?: string }
}

export interface NetworkResponseEvent extends BaseEvent {
  type: 'network.response'
  data: {
    cdpRequestId: string
    requestId: string
    url: string
    status: number
    headers: Record<string, string>
    bodyRef?: string
    bodySummary?: BodySummary
  }
}

export interface NetworkErrorEvent extends BaseEvent {
  type: 'network.error'
  data: { url: string; errorText: string }
}

declare module '@introspection/types' {
  interface TraceEventMap {
    'network.request': NetworkRequestEvent
    'network.response': NetworkResponseEvent
    'network.error': NetworkErrorEvent
  }
}
