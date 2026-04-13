# @introspection/plugin-redux

Captures store dispatches from any state library wired up to the Redux DevTools Extension. Works zero-config with Redux, Zustand, MobX-state-tree, XState, Jotai, Effector, Valtio, and anything else that speaks the devtools-extension protocol.

Records every action dispatch with full payloads and optional before/after state snapshots. Works out-of-the-box with any store already connected to Redux DevTools — no app modifications needed. Useful for tracing state changes, correlating user actions with state mutations, and understanding the sequence of dispatches.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [Supported libraries](#supported-libraries)
- [Multiple stores](#multiple-stores)
- [Options](#options)
- [What it emits](#what-it-emits)
- [Caveats](#caveats)

## Install

```bash
pnpm add -D @introspection/plugin-redux
```

## Usage

```ts
import { attach } from '@introspection/playwright'
import { redux } from '@introspection/plugin-redux'

const handle = await attach(page, { plugins: [redux()] })
```

That's it — no app changes required, as long as the store is connected to Redux DevTools (the default for RTK in development, and for most libraries' `devtools` middleware).

## Supported libraries

| Library | Enabled by |
|---|---|
| Redux + Redux Toolkit | `configureStore({ reducer })` (devtools on by default in dev) |
| Zustand | `create(devtools(stateCreator, { name }))` |
| MobX-state-tree | `connectReduxDevtools(require('remotedev'), store)` |
| XState | `inspect({ iframe: false })` from `@xstate/inspect`, or interpreter `devTools: true` |
| Jotai | `useAtomDevtools(atom, { name })` |
| Effector | `attachReduxDevTools()` |
| Valtio | `devtools(state, { name })` |

## Multiple stores

Each `connect()` / `composeWithDevTools()` call accepts an `options.name`, which devtools normally uses to label panels in the UI. The plugin captures that name and tags every event with `metadata.instance`, so dispatches from different stores stay distinguishable in the trace. Calls without a `name` are auto-numbered (`instance-1`, `instance-2`, …).

```ts
introspect events --type redux.dispatch --filter 'event.metadata.instance === "cart"'
```

## Options

```ts
redux({
  captureState: true,  // default: false
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `captureState` | `boolean` | `false` | Snapshot store state before and after each dispatch. Off by default — full state can be large and expensive to clone on every action. |

## What it emits

| Event type | Description |
|---|---|
| `redux.dispatch` | Fires for every action dispatched through a connected store |

```ts
{
  id: string
  timestamp: number
  type: 'redux.dispatch'
  metadata: {
    action: string        // action.type, the string action name, or String(action)
    instance?: string     // the store's `name` from connect()/composeWithDevTools() options
    payload?: unknown     // action.payload, JSON-cloned (omitted if undefined or non-cloneable)
    stateBefore?: unknown // only when captureState: true
    stateAfter?: unknown  // only when captureState: true
  }
}
```

## Caveats

### Devtools must be enabled

The plugin only sees stores that opted into Redux DevTools. RTK's `configureStore` and most `devtools` middlewares enable this by default in development but disable it in production builds — if you're testing a production bundle, the store will skip our hooks entirely. Either flip `devTools: true` explicitly or test against a dev build.

### JSON-cloned payloads and state

Payloads and state are captured via `JSON.parse(JSON.stringify(...))`. Non-serializable values (functions, `Map`, `Set`, circular refs, class instances) are dropped or throw silently — the action still dispatches normally, but those fields are omitted from the event.

### `captureState` cost

Cloning the full store on every dispatch is O(state size) per action. For large stores or chatty action streams, leave `captureState` off and rely on `action` + `payload` alone.
