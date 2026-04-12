import type { IntrospectionPlugin, PluginContext } from '@introspection/types'

export type { ReduxDispatchEvent } from '@introspection/types'

export interface ReduxPluginOptions {
  /** Capture state before/after each dispatch. Can be expensive. Default: false */
  captureState?: boolean
}

export function redux(options?: ReduxPluginOptions): IntrospectionPlugin {
  const captureState = options?.captureState ?? false

  const script = `
    (function() {
      function patchStore(store) {
        if (store.__introspect_patched__) return;
        store.__introspect_patched__ = true;
        var originalDispatch = store.dispatch;
        store.dispatch = function(action) {
          var event = {
            type: 'redux.dispatch',
            metadata: { action: action.type || String(action) }
          };
          if (action.payload !== undefined) {
            try { event.metadata.payload = JSON.parse(JSON.stringify(action.payload)); } catch(e) {}
          }
          ${captureState ? `
          try { event.metadata.stateBefore = JSON.parse(JSON.stringify(store.getState())); } catch(e) {}
          ` : ''}
          var result = originalDispatch.apply(store, arguments);
          ${captureState ? `
          try { event.metadata.stateAfter = JSON.parse(JSON.stringify(store.getState())); } catch(e) {}
          ` : ''}
          if (window.__introspect_push__) {
            window.__introspect_push__(JSON.stringify(event));
          }
          return result;
        };
      }

      // Patch immediately if store exists
      if (window.__REDUX_STORE__) patchStore(window.__REDUX_STORE__);

      // Watch for store to be set later
      var existing = window.__REDUX_STORE__;
      Object.defineProperty(window, '__REDUX_STORE__', {
        get: function() { return existing; },
        set: function(store) {
          existing = store;
          if (store) patchStore(store);
        },
        configurable: true
      });
    })();
  `

  return {
    name: 'redux',
    description: 'Captures Redux/Rematch store dispatches',
    events: {
      'redux.dispatch': 'Store dispatch with action type and optional payload/state',
    },
    script,
    async install(_context: PluginContext): Promise<void> {
      // All work is done browser-side via the script
    },
  }
}
