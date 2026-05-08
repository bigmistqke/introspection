import { createDebug } from '@introspection/utils'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import { BROWSER_SCRIPT } from './page-script.js'

export type {
  IdbDatabaseEvent,
  IdbSchemaEvent,
  IdbTransactionEvent,
  IdbWriteEvent,
  IdbReadEvent,
  IdbSnapshotEvent,
  IdbTransactionMode,
} from '@introspection/types'

export interface IndexedDBOptions {
  reads?: boolean
  dataSnapshots?: boolean
  origins?: string[]
  databases?: string[]
  verbose?: boolean
}

type SnapshotTrigger = 'install' | 'manual' | 'js.error' | 'detach'

interface CdpDatabaseWithStores {
  name: string
  version: number
  objectStores: Array<{
    name: string
    keyPath?: { type: string; string?: string; array?: string[] } | null
    autoIncrement: boolean
    indexes: Array<{
      name: string
      keyPath: { type: string; string?: string; array?: string[] }
      unique: boolean
      multiEntry: boolean
    }>
  }>
}

function unwrapKeyPath(kp?: { type: string; string?: string; array?: string[] } | null): string | string[] | null {
  if (!kp) return null
  if (kp.type === 'string') return kp.string ?? ''
  if (kp.type === 'array') return kp.array ?? []
  return null
}

export function indexedDB(options?: IndexedDBOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-indexeddb', options?.verbose ?? false)
  const captureReads = options?.reads ?? false
  const dataSnapshots = options?.dataSnapshots ?? false
  const origins = options?.origins ?? ['*']
  const databasesFilter = options?.databases

  function originAllowed(origin: string): boolean {
    if (origins.includes('*')) return true
    return origins.includes(origin)
  }

  return {
    name: 'indexeddb',
    description: 'Captures IndexedDB activity (database lifecycle, schema, transactions, writes; reads + data snapshots opt-in)',
    events: {
      'idb.database': 'Database lifecycle (open / upgrade / close / delete)',
      'idb.schema': 'Schema definition (createObjectStore / deleteObjectStore / createIndex / deleteIndex)',
      'idb.transaction': 'Transaction lifecycle (begin / complete / abort / error)',
      'idb.write': 'Write op (add / put / delete / clear)',
      'idb.read': 'Read op (get / getAll / cursors / count); only when reads: true',
      'idb.snapshot': 'Schema (and optional data) snapshot at install + bus triggers',
    },
    async install(ctx: PluginContext): Promise<void> {
      debug('installing', { captureReads, dataSnapshots, origins, databasesFilter })
      void BROWSER_SCRIPT // page-side patching wired in Task 4

      let topOrigin: string | undefined

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
        const targetOrigins = origins.includes('*')
          ? (topOrigin ? [topOrigin] : [])
          : origins
        for (const origin of targetOrigins) {
          if (!originAllowed(origin)) continue

          let names: string[] = []
          try {
            const r = await ctx.cdpSession.send('IndexedDB.requestDatabaseNames', {
              securityOrigin: origin,
            }) as { databaseNames: string[] }
            names = r.databaseNames
          } catch (err) {
            debug('requestDatabaseNames failed', origin, (err as Error).message)
            continue
          }

          if (databasesFilter) names = names.filter(n => databasesFilter.includes(n))

          const databases: Array<{
            name: string
            version: number
            objectStores: Array<{
              name: string
              keyPath: string | string[] | null
              autoIncrement: boolean
              indexes: Array<{ name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }>
            }>
          }> = []

          for (const name of names) {
            try {
              const r = await ctx.cdpSession.send('IndexedDB.requestDatabase', {
                securityOrigin: origin, databaseName: name,
              }) as { databaseWithObjectStores: CdpDatabaseWithStores }
              const db = r.databaseWithObjectStores
              databases.push({
                name: db.name,
                version: db.version,
                objectStores: db.objectStores.map(s => ({
                  name: s.name,
                  keyPath: unwrapKeyPath(s.keyPath),
                  autoIncrement: s.autoIncrement,
                  indexes: s.indexes.map(i => ({
                    name: i.name,
                    keyPath: (unwrapKeyPath(i.keyPath) ?? '') as string | string[],
                    unique: i.unique,
                    multiEntry: i.multiEntry,
                  })),
                })),
              })
            } catch (err) {
              debug('requestDatabase failed', origin, name, (err as Error).message)
            }
          }

          await ctx.emit({
            type: 'idb.snapshot',
            metadata: { trigger, origin, databases },
          })
        }
      }

      await snapshotOnce('install')
    },
  }
}
