import BROWSER_SCRIPT from '../dist/browser.iife.js'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import './event-types.js'

export type {
  PerfCwvEvent, PerfResourceEvent, PerfLongTaskEvent, PerfLayoutShiftEvent, PerfPaintEvent,
} from './event-types.js'

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
