import { createDebug } from '@introspection/utils'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'

export type { WebStorageWriteEvent, WebStorageReadEvent, WebStorageSnapshotEvent, WebStorageType } from '@introspection/types'

export interface WebStorageOptions {
  /** Which Web Storage areas to capture. Default: both. */
  stores?: Array<'localStorage' | 'sessionStorage'>
  /** Capture `getItem` reads. Default: false. */
  reads?: boolean
  /**
   * Restrict capture to specific origins. Default: top-frame origin only.
   * Pass an explicit list (e.g. `['https://app.example.com']`) to widen.
   */
  origins?: string[]
  verbose?: boolean
}

export function webStorage(options?: WebStorageOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-web-storage', options?.verbose ?? false)
  const stores = options?.stores ?? ['localStorage', 'sessionStorage']
  const captureReads = options?.reads ?? false
  const explicitOrigins = options?.origins

  return {
    name: 'web-storage',
    description: 'Captures localStorage and sessionStorage activity',
    events: {
      'webStorage.write': 'localStorage / sessionStorage mutation (set, remove, clear)',
      'webStorage.read': 'localStorage / sessionStorage read (only when reads: true)',
      'webStorage.snapshot': 'Full storage dump at install and on bus triggers',
    },
    async install(_ctx: PluginContext): Promise<void> {
      debug('installing', { stores, captureReads, explicitOrigins })
      // Filled in by later tasks.
    },
  }
}
