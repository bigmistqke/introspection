import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import { createDebug } from '@introspection/utils'

export type { ReduxDispatchEvent } from '@introspection/types'

export interface ReduxPluginOptions {
  verbose?: boolean
  /** Capture state before/after each dispatch. Can be expensive. Default: false */
  captureState?: boolean
}

export function redux(options?: ReduxPluginOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-redux', options?.verbose ?? false)
  const captureState = options?.captureState ?? false

  // Installs stubs for the Redux DevTools Extension globals so any store
  // wired up with `composeWithDevTools` / `__REDUX_DEVTOOLS_EXTENSION__` —
  // including Redux Toolkit's `configureStore` in dev mode, Zustand's
  // `devtools` middleware, and other devtools-extension-compatible libraries —
  // connects to us automatically. No app changes required.
  const script = `
    (function() {
      var captureState = ${captureState ? 'true' : 'false'};
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
        var event = {
          type: 'redux.dispatch',
          metadata: { action: actionName(action) }
        };
        if (instance) event.metadata.instance = instance;
        if (action && typeof action === 'object' && action.payload !== undefined) {
          var payload = clone(action.payload);
          if (payload !== undefined) event.metadata.payload = payload;
        }
        if (captureState) {
          if (stateBefore !== undefined) event.metadata.stateBefore = stateBefore;
          if (stateAfter !== undefined) event.metadata.stateAfter = stateAfter;
        }
        if (window.__introspect_push__) {
          window.__introspect_push__(JSON.stringify(event));
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
            var originalDispatch = store.dispatch;
            store.dispatch = function (action) {
              var stateBefore = captureState ? clone(store.getState()) : undefined;
              var result = originalDispatch.apply(store, arguments);
              var stateAfter = captureState ? clone(store.getState()) : undefined;
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

      // composeWithDevTools — supports both call shapes:
      //   composeWithDevTools(...enhancers)         // direct
      //   composeWithDevTools(options)(...enhancers) // curried with options (RTK)
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

      // Direct enhancer: createStore(reducer, __REDUX_DEVTOOLS_EXTENSION__(options))
      function extension(connectOptions) { return instrument(connectOptions); }

      // Manual connect API — used by Zustand, MobX-state-tree, XState, Jotai,
      // Effector, Valtio, and any library that talks to devtools by hand.
      extension.connect = function (connectOptions) {
        var instance = instanceNameFromOptions(connectOptions);
        var lastState;
        return {
          init: function (state) { lastState = captureState ? clone(state) : undefined },
          send: function (action, state) {
            var nextState = captureState ? clone(state) : undefined;
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
    async install(_context: PluginContext): Promise<void> {
      debug('installing', { captureState })
      // All work is done browser-side via the script
    },
  }
}
