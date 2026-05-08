import type { IntrospectionPlugin, PluginContext, EmitInput } from '@introspection/types'
import { createDebug } from '@introspection/utils'
import jsonpatch, { Operation } from 'fast-json-patch'

export type { ReduxDispatchEvent, ReduxSnapshotEvent } from '@introspection/types'

export { reconstruct, ReduxError } from './reconstruct.js'

export interface ReduxPluginOptions {
  verbose?: boolean
}

export function redux(options?: ReduxPluginOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-redux', options?.verbose ?? false)

  // Installs stubs for the Redux DevTools Extension globals so any store
  // wired up with `composeWithDevTools` / `__REDUX_DEVTOOLS_EXTENSION__` —
  // including Redux Toolkit's `configureStore` in dev mode, Zustand's
  // `devtools` middleware, and other devtools-extension-compatible libraries —
  // connects to us automatically. No app changes required.
  const script = `
    (function() {
      var instanceCounter = 0;

      function clone(value) {
        try { return JSON.parse(JSON.stringify(value)) } catch (e) { return undefined }
      }

      function actionName(action) {
        if (typeof action === 'string') return action;
        if (action && typeof action === 'object') return action.type || String(action);
        return String(action);
      }

      function emit(action, instance, stateBefore, stateAfter) {
        if (action == null) return;
        var actionPayload = (action && typeof action === 'object' && action.payload !== undefined)
          ? clone(action.payload)
          : undefined;
        var payload = JSON.stringify({
          action: actionName(action),
          instance: instance,
          actionPayload: actionPayload,
          stateBefore: stateBefore,
          stateAfter: stateAfter
        });
        if (window.__introspection_plugin_redux_dispatch) {
          window.__introspection_plugin_redux_dispatch(payload);
        }
      }

      function emitSnapshot(state) {
        var snapshotEvent = JSON.stringify({ type: 'redux.snapshot', state: clone(state) });
        if (window.__introspection_plugin_redux_snapshot) {
          window.__introspection_plugin_redux_snapshot(snapshotEvent);
        }
      }

      function instanceNameFromOptions(options) {
        if (options && typeof options === 'object' && typeof options.name === 'string') {
          return options.name;
        }
        return 'instance-' + (++instanceCounter);
      }

      function instrument(connectOptions) {
        var instance = instanceNameFromOptions(connectOptions);
        return function (createStore) {
          return function (reducer, preloadedState) {
            var store = createStore(reducer, preloadedState);
            emitSnapshot(store.getState());
            var originalDispatch = store.dispatch;
            store.dispatch = function (action) {
              var stateBefore = clone(store.getState());
              var result = originalDispatch.apply(store, arguments);
              var stateAfter = clone(store.getState());
              emit(action, instance, stateBefore, stateAfter);
              return result;
            };
            return store;
          };
        };
      }

      function compose() {
        var funcs = Array.prototype.slice.call(arguments);
        if (funcs.length === 0) return function (arg) { return arg };
        if (funcs.length === 1) return funcs[0];
        return funcs.reduce(function (a, b) {
          return function () { return a(b.apply(null, arguments)) };
        });
      }

      function composeWithDevTools() {
        var funcs = Array.prototype.slice.call(arguments);
        if (funcs.length === 0) return instrument();
        if (funcs.length === 1 && typeof funcs[0] === 'object' && typeof funcs[0] !== 'function') {
          var connectOptions = funcs[0];
          return function () {
            var inner = Array.prototype.slice.call(arguments);
            return compose.apply(null, [instrument(connectOptions)].concat(inner));
          };
        }
        return compose.apply(null, [instrument()].concat(funcs));
      }

      function extension(connectOptions) { return instrument(connectOptions); }

      extension.connect = function (connectOptions) {
        var instance = instanceNameFromOptions(connectOptions);
        var lastState;
        return {
          init: function (state) {
            lastState = clone(state);
            emitSnapshot(state);
          },
          send: function (action, state) {
            var nextState = clone(state);
            emit(action, instance, lastState, nextState);
            lastState = nextState;
          },
          subscribe: function () { return function () {} },
          unsubscribe: function () {},
          error: function () {},
        };
      };
      extension.disconnect = function () {};
      extension.send = function () {};
      extension.listen = function () {};

      Object.defineProperty(window, '__REDUX_DEVTOOLS_EXTENSION__', {
        value: extension, configurable: true, writable: true
      });
      Object.defineProperty(window, '__REDUX_DEVTOOLS_EXTENSION_COMPOSE__', {
        value: composeWithDevTools, configurable: true, writable: true
      });
    })();
  `

  return {
    name: 'redux',
    description: 'Captures dispatches from any store wired up to the Redux DevTools Extension (Redux, Zustand, MobX-state-tree, XState, Jotai, Effector, Valtio)',
    events: {
      'redux.dispatch': 'Store dispatch with action type and optional payload/state',
    },
    script,
    async install(ctx: PluginContext): Promise<void> {
      debug('installing')

      await ctx.cdpSession.send('Runtime.addBinding', {
        name: '__introspection_plugin_redux_dispatch',
      })
      await ctx.cdpSession.send('Runtime.addBinding', {
        name: '__introspection_plugin_redux_snapshot',
      })

      ctx.cdpSession.on('Runtime.bindingCalled', async (params: unknown) => {
        const { name, payload } = params as { name: string; payload: string }

        if (name === '__introspection_plugin_redux_snapshot') {
          try {
            const { type, state } = JSON.parse(payload)
            if (type === 'redux.snapshot' && state !== undefined) {
              const ref = await ctx.writeAsset({ format: 'json', content: JSON.stringify(state) })
              await ctx.emit({
                type: 'redux.snapshot',
                payloads: { state: ref },
              })
            }
          } catch (err) {
            debug('snapshot binding error', (err as Error).message)
          }
          return
        }

        if (name === '__introspection_plugin_redux_dispatch') {
          try {
            const { action, instance, actionPayload, stateBefore, stateAfter } = JSON.parse(payload)

            const diff: Operation[] = stateBefore !== undefined && stateAfter !== undefined
              ? jsonpatch.compare(stateBefore, stateAfter)
              : []

            const event: EmitInput = {
              type: 'redux.dispatch',
              metadata: {
                action,
                ...(instance && { instance }),
                ...(actionPayload !== undefined && { payload: actionPayload }),
                diff,
              },
            }

            await ctx.emit(event)
          } catch (err) {
            debug('dispatch binding error', (err as Error).message)
          }
        }
      })
    },
  }
}
