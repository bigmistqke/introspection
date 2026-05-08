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

type SnapshotTrigger = 'install' | 'manual' | 'js.error' | 'detach'

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
    async install(ctx: PluginContext): Promise<void> {
      debug('installing', { stores, captureReads, explicitOrigins })

      let topOrigin: string | undefined

      function originAllowed(origin: string): boolean {
        if (explicitOrigins) return explicitOrigins.includes(origin)
        return origin === topOrigin
      }

      try {
        await ctx.cdpSession.send('Page.enable')
        const frameTree = await ctx.cdpSession.send('Page.getFrameTree') as {
          frameTree: { frame: { url: string; securityOrigin?: string } }
        }
        const root = frameTree.frameTree.frame
        topOrigin = root.securityOrigin ?? (() => {
          try { return new URL(root.url).origin } catch { return undefined }
        })()
        debug('top origin', topOrigin)
      } catch (err) {
        debug('failed to determine top origin', (err as Error).message)
      }

      ctx.cdpSession.on('Page.frameNavigated', (rawParams) => {
        const params = rawParams as { frame: { id: string; parentId?: string; url: string; securityOrigin?: string } }
        if (params.frame.parentId) return
        topOrigin = params.frame.securityOrigin ?? (() => {
          try { return new URL(params.frame.url).origin } catch { return undefined }
        })()
        debug('top origin updated', topOrigin)
      })

      async function snapshotOnce(trigger: SnapshotTrigger): Promise<void> {
        const targetOrigins = explicitOrigins ?? (topOrigin ? [topOrigin] : [])
        for (const origin of targetOrigins) {
          if (!originAllowed(origin)) continue
          const metadata: {
            trigger: SnapshotTrigger
            origin: string
            localStorage?: Record<string, string>
            sessionStorage?: Record<string, string>
          } = { trigger, origin }

          for (const store of stores) {
            try {
              const result = await ctx.cdpSession.send('DOMStorage.getDOMStorageItems', {
                storageId: { securityOrigin: origin, isLocalStorage: store === 'localStorage' },
              }) as { entries: Array<[string, string]> }
              const entries = Object.fromEntries(result.entries)
              if (store === 'localStorage') metadata.localStorage = entries
              else metadata.sessionStorage = entries
            } catch (err) {
              debug('snapshot fetch failed', store, origin, (err as Error).message)
            }
          }

          await ctx.emit({ type: 'webStorage.snapshot', metadata })
        }
      }

      await ctx.cdpSession.send('DOMStorage.enable')
      await snapshotOnce('install')
    },
  }
}
