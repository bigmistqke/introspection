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

const BINDING_NAME = '__introspection_plugin_web_storage'

const BROWSER_SCRIPT = `
(function() {
  var BINDING = '${BINDING_NAME}';
  if (typeof Storage === 'undefined') return;
  if (window[BINDING + '_installed']) return;
  window[BINDING + '_installed'] = true;

  var origGetItem    = Storage.prototype.getItem;
  var origSetItem    = Storage.prototype.setItem;
  var origRemoveItem = Storage.prototype.removeItem;
  var origClear      = Storage.prototype.clear;
  var origKey        = Storage.prototype.key;
  var lengthDesc     = Object.getOwnPropertyDescriptor(Storage.prototype, 'length');

  function storageType(self) {
    if (self === window.localStorage)   return 'localStorage';
    if (self === window.sessionStorage) return 'sessionStorage';
    return null;
  }

  function emit(payload) {
    try {
      payload.origin = location.origin;
      var binding = window[BINDING];
      if (typeof binding === 'function') binding(JSON.stringify(payload));
    } catch (_) { /* swallow */ }
  }

  Storage.prototype.setItem = function(key, value) {
    var t = storageType(this);
    var oldValue = t ? origGetItem.call(this, key) : null;
    var result = origSetItem.call(this, key, value);
    if (t) {
      var payload = { kind: 'write', op: 'set', storageType: t, key: String(key), newValue: String(value) };
      if (oldValue !== null) payload.oldValue = oldValue;
      emit(payload);
    }
    return result;
  };

  Storage.prototype.removeItem = function(key) {
    var t = storageType(this);
    var oldValue = t ? origGetItem.call(this, key) : null;
    var result = origRemoveItem.call(this, key);
    if (t && oldValue !== null) {
      emit({ kind: 'write', op: 'remove', storageType: t, key: String(key), oldValue: oldValue });
    }
    return result;
  };

  Storage.prototype.clear = function() {
    var t = storageType(this);
    var keys = [];
    if (t && lengthDesc && lengthDesc.get) {
      var len = lengthDesc.get.call(this);
      for (var i = 0; i < len; i++) {
        var k = origKey.call(this, i);
        if (k !== null) keys.push(k);
      }
    }
    var result = origClear.call(this);
    if (t) emit({ kind: 'write', op: 'clear', storageType: t, clearedKeys: keys });
    return result;
  };

  if (window['${BINDING_NAME}_reads']) {
    Storage.prototype.getItem = function(key) {
      var value = origGetItem.call(this, key);
      var t = storageType(this);
      if (t) emit({ kind: 'read', storageType: t, key: String(key), value: value });
      return value;
    };
  }
})();
`

type PagePayload =
  | { kind: 'write'; op: 'set'; storageType: 'localStorage' | 'sessionStorage'; origin: string; key: string; oldValue?: string; newValue: string }
  | { kind: 'write'; op: 'remove'; storageType: 'localStorage' | 'sessionStorage'; origin: string; key: string; oldValue: string }
  | { kind: 'write'; op: 'clear'; storageType: 'localStorage' | 'sessionStorage'; origin: string; clearedKeys: string[] }
  | { kind: 'read'; storageType: 'localStorage' | 'sessionStorage'; origin: string; key: string; value: string | null }

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

      function handlePagePayload(payload: PagePayload): void {
        if (!originAllowed(payload.origin)) return
        if (!stores.includes(payload.storageType)) return

        if (payload.kind === 'read') {
          if (!captureReads) return
          void ctx.emit({
            type: 'webStorage.read',
            metadata: {
              storageType: payload.storageType,
              origin: payload.origin,
              key: payload.key,
              value: payload.value,
            },
          })
          return
        }

        const md: {
          storageType: 'localStorage' | 'sessionStorage'
          operation: 'set' | 'remove' | 'clear'
          origin: string
          key?: string
          oldValue?: string
          newValue?: string
          clearedKeys?: string[]
        } = {
          storageType: payload.storageType,
          operation: payload.op,
          origin: payload.origin,
        }
        if (payload.op === 'set') {
          md.key = payload.key
          md.newValue = payload.newValue
          if (payload.oldValue !== undefined) md.oldValue = payload.oldValue
        } else if (payload.op === 'remove') {
          md.key = payload.key
          md.oldValue = payload.oldValue
        } else {
          md.clearedKeys = payload.clearedKeys
        }

        void ctx.emit({ type: 'webStorage.write', metadata: md })
      }

      await ctx.cdpSession.send('Runtime.addBinding', { name: BINDING_NAME })
      ctx.cdpSession.on('Runtime.bindingCalled', (rawParams) => {
        const params = rawParams as { name: string; payload: string }
        if (params.name !== BINDING_NAME) return
        try {
          const payload = JSON.parse(params.payload) as PagePayload
          handlePagePayload(payload)
        } catch (err) {
          debug('binding parse error', (err as Error).message)
        }
      })

      const readsToggle = `window.${BINDING_NAME}_reads = ${captureReads ? 'true' : 'false'};`
      await ctx.cdpSession.send('Page.addScriptToEvaluateOnNewDocument', {
        source: readsToggle + BROWSER_SCRIPT,
      })

      // Init scripts only run on future navigations, so we also evaluate the
      // wrapper in the current realm to cover tests that attach after navigation.
      try {
        await ctx.cdpSession.send('Runtime.evaluate', {
          expression: readsToggle + BROWSER_SCRIPT,
          awaitPromise: false,
        })
      } catch (err) {
        debug('current-realm patch failed', (err as Error).message)
      }

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

      ctx.bus.on('manual', async () => {
        debug('snapshot triggered: manual')
        await snapshotOnce('manual')
      })
      ctx.bus.on('js.error', async () => {
        debug('snapshot triggered: js.error')
        await snapshotOnce('js.error')
      })
      ctx.bus.on('detach', async () => {
        debug('snapshot triggered: detach')
        await snapshotOnce('detach')
      })
    },
  }
}
