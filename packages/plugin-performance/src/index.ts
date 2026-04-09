import type { IntrospectionPlugin } from '@introspection/types'

export interface PerformanceOptions {
  resources?: boolean
  longTasks?: boolean
}

export function performance(_options?: PerformanceOptions): IntrospectionPlugin {
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
      resources: { description: 'Capture resource timing entries', value: _options?.resources ?? true },
      longTasks: { description: 'Capture long tasks >50ms', value: _options?.longTasks ?? true },
    },

    async install(): Promise<void> {
      // no-op — browser script handles everything via __introspect_push__
    },
  }
}
