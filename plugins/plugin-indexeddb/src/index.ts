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
  /** Capture reads (get/getAll/cursors/count). Default: false. */
  reads?: boolean
  /** Include object-store contents in `idb.snapshot` events. Default: false. */
  dataSnapshots?: boolean
  /** Restrict capture to specific origins. Default: ['*']. */
  origins?: string[]
  /** Restrict capture to specific database names. Default: all. */
  databases?: string[]
  verbose?: boolean
}

export function indexedDB(options?: IndexedDBOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-indexeddb', options?.verbose ?? false)
  const captureReads = options?.reads ?? false
  const dataSnapshots = options?.dataSnapshots ?? false
  const origins = options?.origins ?? ['*']
  const databases = options?.databases

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
    async install(_ctx: PluginContext): Promise<void> {
      debug('installing', { captureReads, dataSnapshots, origins, databases })
      // Filled in by later tasks.
      void BROWSER_SCRIPT
    },
  }
}
