import BROWSER_SCRIPT from '../dist/browser.iife.js'
import type { IntrospectionPlugin, PluginContext, BaseEvent } from '@introspection/types'

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

export interface PerformanceOptions {
  resources?: boolean
  longTasks?: boolean
}

export function performance(options?: PerformanceOptions): IntrospectionPlugin {
  return {
    name: 'performance',
    description: 'Captures Core Web Vitals, resource timing, long tasks, layout shifts, and paint timing',
    events: {
      'perf.cwv': 'Core Web Vital entry (LCP, CLS, or INP)',
      'perf.resource': 'Resource timing entry with full waterfall breakdown',
      'perf.long-task': 'Long task (>50ms) with script attribution',
      'perf.layout-shift': 'Individual layout shift with score and affected elements',
      'perf.paint': 'First Paint or First Contentful Paint timing',
    },
    options: {
      resources: { description: 'Capture resource timing entries', value: options?.resources ?? true },
      longTasks: { description: 'Capture long tasks >50ms', value: options?.longTasks ?? true },
    },
    script: `var __introspect_perf_config__=${JSON.stringify({ resources: options?.resources ?? true, longTasks: options?.longTasks ?? true })};${BROWSER_SCRIPT}`,

    async install(_context: PluginContext): Promise<void> {
      // no-op — browser script handles everything via __introspect_push__
    },
  }
}
