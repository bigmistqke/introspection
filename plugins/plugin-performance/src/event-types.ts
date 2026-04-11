import type { BaseEvent } from '@introspection/types'

export interface PerfCwvEvent extends BaseEvent {
  type: 'perf.cwv'
  data: {
    metric: 'lcp' | 'cls' | 'inp'
    value: number
    startTime?: number
    element?: string
    url?: string
    size?: number
  }
}

export interface PerfResourceEvent extends BaseEvent {
  type: 'perf.resource'
  data: {
    name: string
    initiatorType: string
    transferSize: number
    encodedBodySize: number
    decodedBodySize: number
    dns: number
    tcp: number
    tls: number
    ttfb: number
    download: number
    total: number
    renderBlocking?: string
  }
}

export interface PerfLongTaskEvent extends BaseEvent {
  type: 'perf.long-task'
  data: { duration: number; startTime: number; attribution: string }
}

export interface PerfLayoutShiftEvent extends BaseEvent {
  type: 'perf.layout-shift'
  data: {
    score: number
    hadRecentInput: boolean
    sources: Array<{
      selector?: string
      previousRect: { x: number; y: number; width: number; height: number }
      currentRect: { x: number; y: number; width: number; height: number }
    }>
  }
}

export interface PerfPaintEvent extends BaseEvent {
  type: 'perf.paint'
  data: { name: string; startTime: number }
}

declare module '@introspection/types' {
  interface TraceEventMap {
    'perf.cwv': PerfCwvEvent
    'perf.resource': PerfResourceEvent
    'perf.long-task': PerfLongTaskEvent
    'perf.layout-shift': PerfLayoutShiftEvent
    'perf.paint': PerfPaintEvent
  }
}
