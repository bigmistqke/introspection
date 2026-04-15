# Redux JSON Patch Introspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace full state snapshots in redux.dispatch events with compact JSON Patch diffs in metadata, and add a redux.snapshot event type for full state captures on plugin init.

**Architecture:** Event-sourced approach with checkpointing. A `redux.snapshot` event (emitted once at plugin init) stores the full initial state as a JSON asset. Subsequent `redux.dispatch` events store only the JSON Patch diff in metadata, making log rendering zero-fetch and storage minimal. Consumers can reconstruct state at any point by replaying patches from the nearest preceding snapshot.

**Tech Stack:** TypeScript, JSON Patch (RFC 6902), @introspection/types, plugin-redux

---

## File Structure

```
packages/types/src/index.ts            # Add ReduxSnapshotEvent, JsonPatchOperation, update ReduxDispatchEvent
plugins/plugin-redux/package.json      # Add fast-json-patch dependency
plugins/plugin-redux/src/index.ts      # Emit redux.snapshot, compute JSON Patch per dispatch
plugins/plugin-redux/test/redux.spec.ts # Update tests for new event shapes
```

---

## Task 1: Add JSON Patch dependency to plugin-redux

**Files:**
- Modify: `plugins/plugin-redux/package.json`

- [ ] **Step 1: Add fast-json-patch to dependencies**

Run: `cd plugins/plugin-redux && npm install fast-json-patch && npm install -D @types/fast-json-patch`

- [ ] **Step 2: Verify dependency is installed**

Run: `cat plugins/plugin-redux/package.json | grep -A1 '"fast-json-patch"'`
Expected output: `"fast-json-patch": "^x.x.x"` (version may vary)

---

## Task 2: Update @introspection/types with new Redux event types

**Files:**
- Modify: `packages/types/src/index.ts:284-299`

- [ ] **Step 1: Add JSON Patch operation type import or define inline**

Add after line 283 (before Redux section comment):

```typescript
export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test'
  path: string
  value?: unknown
  from?: string
}
```

- [ ] **Step 2: Add ReduxSnapshotEvent interface**

Replace the existing ReduxDispatchEvent (lines 286-295) with:

```typescript
// ─── Plugin events: redux ───────────────────────────────────────────────────

export interface ReduxSnapshotEvent extends BaseEvent {
  type: 'redux.snapshot'
  assets: [AssetRef] // { path: 'initial-state.json', kind: 'json' }
  metadata?: never
}

export interface ReduxDispatchEvent extends BaseEvent {
  type: 'redux.dispatch'
  metadata: {
    action: string
    instance?: string
    payload?: unknown
    diff: JsonPatchOperation[]
  }
}
```

- [ ] **Step 3: Update TraceEventMap to include redux.snapshot**

In the TraceEventMap interface (around line 398-399), add:

```typescript
// Redux
'redux.snapshot': ReduxSnapshotEvent
'redux.dispatch': ReduxDispatchEvent
```

- [ ] **Step 4: Verify types compile**

Run: `npm run typecheck --workspace=packages/types`
Expected: No errors

---

## Task 3: Update plugin-redux to emit snapshots and compute patches

**Files:**
- Modify: `plugins/plugin-redux/src/index.ts`

- [ ] **Step 1: Update imports and options**

Replace the imports and ReduxPluginOptions (lines 1-14):

```typescript
import type { IntrospectionPlugin, PluginContext, EmitInput } from '@introspection/types'
import { createDebug } from '@introspection/utils'
import { compare, Operation } from 'fast-json-patch'

export type { ReduxDispatchEvent, ReduxSnapshotEvent } from '@introspection/types'

export interface ReduxPluginOptions {
  verbose?: boolean
}
```

- [ ] **Step 2: Update browser script**

Replace the `script` variable (lines 21-141) with:

```typescript
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
```

- [ ] **Step 3: Update install function**

Replace the `install` function (lines 150-192) with:

```typescript
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
          const ref = await ctx.writeAsset({ kind: 'json', content: JSON.stringify(state) })
          await ctx.emit({
            type: 'redux.snapshot',
            assets: [ref],
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
          ? compare(stateBefore, stateAfter)
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
}
```

- [ ] **Step 4: Build plugin and verify no errors**

Run: `npm run build --workspace=plugins/plugin-redux`
Expected: Build completes without errors

---

## Task 4: Update plugin-redux tests for new event shapes

**Files:**
- Modify: `plugins/plugin-redux/test/redux.spec.ts`

- [ ] **Step 1: Update existing tests to expect diff instead of stateBefore/stateAfter**

Replace test `captureState: snapshots store state before/after as assets` (lines 113-145) with:

```typescript
test('redux + react: emits redux.snapshot on store creation', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [redux()] })
  await page.goto('http://localhost:8765/redux-react/index.html')

  await page.waitForTimeout(100)
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const snapshots = events.filter((e: any) => e.type === 'redux.snapshot')

  expect(snapshots.length).toBe(1)
  const snapshot = snapshots[0]
  expect(snapshot.assets).toHaveLength(1)
  expect(snapshot.assets[0].kind).toBe('json')

  const entries = await readdir(outDir)
  const sessionDir = join(outDir, entries[0])
  const state = JSON.parse(await readFile(join(sessionDir, snapshot.assets[0].path), 'utf-8'))
  expect(state).toHaveProperty('count')
  expect(state).toHaveProperty('items')
})
```

- [ ] **Step 2: Add test for JSON Patch diff in dispatch metadata**

Add new test after the snapshot test:

```typescript
test('redux + react: captures diff as JSON Patch in metadata', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [redux()] })
  await page.goto('http://localhost:8765/redux-react/index.html')

  await page.click('#increment')
  await page.waitForTimeout(50)

  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const dispatches = events.filter((e: any) => e.type === 'redux.dispatch')

  // Find INCREMENT dispatch
  const incrementEvent = dispatches.find((e: any) => e.metadata.action === 'INCREMENT')
  expect(incrementEvent).toBeDefined()

  // Should have diff in metadata, not in assets
  expect(incrementEvent.metadata.diff).toBeDefined()
  expect(Array.isArray(incrementEvent.metadata.diff)).toBe(true)

  // Diff should contain replace operation for count path
  const countOps = incrementEvent.metadata.diff.filter((op: any) => op.path.includes('/count'))
  expect(countOps.length).toBeGreaterThan(0)

  // No stateBefore/stateAfter in metadata
  expect(incrementEvent.metadata.stateBefore).toBeUndefined()
  expect(incrementEvent.metadata.stateAfter).toBeUndefined()

  // No assets (diff is self-contained in metadata)
  expect(incrementEvent.assets).toBeUndefined()
})
```

- [ ] **Step 3: Add test for Zustand redux.snapshot emission**

Add new test after the diff test:

```typescript
test('zustand + react: emits redux.snapshot on store creation via connect API', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [redux()] })
  await page.goto('http://localhost:8765/zustand-react/index.html')

  await page.waitForTimeout(100)
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const snapshots = events.filter((e: any) => e.type === 'redux.snapshot')

  // Should have at least one snapshot for the zustand store
  expect(snapshots.length).toBeGreaterThanOrEqual(1)
  const zustandSnapshot = snapshots.find((e: any) =>
    e.assets && e.assets.some((a: any) => a.path.includes('zustand'))
  )
  expect(zustandSnapshot).toBeDefined()
  expect(zustandSnapshot.assets[0].kind).toBe('json')
})
```

- [ ] **Step 4: Add test for Valtio redux.snapshot emission**

Add new test after the Zustand test:

```typescript
test('valtio + react: emits redux.snapshot on store creation via connect API', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [redux()] })
  await page.goto('http://localhost:8765/valtio-react/index.html')

  await page.waitForTimeout(100)
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const snapshots = events.filter((e: any) => e.type === 'redux.snapshot')

  // Should have at least one snapshot for the valtio store
  expect(snapshots.length).toBeGreaterThanOrEqual(1)
  const valtioSnapshot = snapshots.find((e: any) =>
    e.assets && e.assets.some((a: any) => a.path.includes('valtio'))
  )
  expect(valtioSnapshot).toBeDefined()
})
```

- [ ] **Step 5: Run tests to verify new behavior**

Run: `npm run test --workspace=plugins/plugin-redux`
Expected: All tests pass

---

## Task 5: Update event-types.d.ts (manually maintained)

**Files:**
- Modify: `plugins/plugin-redux/dist/event-types.d.ts`

- [ ] **Step 1: Update event-types.d.ts to reflect new event shapes**

Replace the file contents:

```typescript
import { BaseEvent } from '@introspection/types'

interface ReduxSnapshotEvent extends BaseEvent {
  type: 'redux.snapshot'
  assets: [{ path: string; kind: 'json'; size?: number }]
}

interface ReduxDispatchEvent extends BaseEvent {
  type: 'redux.dispatch'
  metadata: {
    action: string
    instance?: string
    payload?: unknown
    diff: Array<{
      op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test'
      path: string
      value?: unknown
      from?: string
    }>
  }
}

declare module '@introspection/types' {
  interface TraceEventMap {
    'redux.snapshot': ReduxSnapshotEvent
    'redux.dispatch': ReduxDispatchEvent
  }
}

export type { ReduxSnapshotEvent, ReduxDispatchEvent }
```

- [ ] **Step 2: Build and verify**

Run: `npm run build --workspace=plugins/plugin-redux`
Expected: Build completes without errors

---

## Summary of Changes

| File | Change |
|------|--------|
| `packages/types/src/index.ts` | Added `ReduxSnapshotEvent`, `JsonPatchOperation`, updated `ReduxDispatchEvent` with `diff` field |
| `plugins/plugin-redux/package.json` | Added `fast-json-patch` dependency |
| `plugins/plugin-redux/src/index.ts` | Emit `redux.snapshot` on init, compute JSON Patch per dispatch, removed `captureState` option |
| `plugins/plugin-redux/test/redux.spec.ts` | Updated tests for new event shapes |
| `plugins/plugin-redux/dist/event-types.d.ts` | Updated type declarations |

---

## New Event Shapes

```typescript
// Emitted once per store creation
{
  type: 'redux.snapshot',
  assets: [{ path: 'initial-state-{n}.json', kind: 'json' }]
}

// Emitted per dispatch
{
  type: 'redux.dispatch',
  metadata: {
    action: 'INCREMENT',
    instance: 'counter-store',  // optional
    payload: { amount: 5 },     // optional
    diff: [
      { op: 'replace', path: '/count', value: 5 }
    ]
  }
}
```

---

## State Reconstruction Algorithm

To reconstruct Redux state at event index `i`:

1. Find the last `redux.snapshot` event at index ≤ `i`
2. Load its JSON asset
3. Apply all `redux.dispatch` patches from that snapshot's index + 1 forward to `i`

```typescript
function reconstructState(events: TraceEvent[], targetIndex: number): unknown {
  const snapshot = findLastSnapshotBefore(events, targetIndex)
  if (!snapshot) throw new Error('No snapshot found')

  const state = JSON.parse(loadAsset(snapshot.assets[0].path))
  const patches = events
    .filter((e, i) => e.type === 'redux.dispatch' && i > events.indexOf(snapshot) && i <= targetIndex)
    .flatMap(e => e.metadata.diff)

  return applyPatch(state, patches).newDocument
}
```

---

## Verification

- [ ] All tests pass: `npm run test --workspace=plugins/plugin-redux`
- [ ] Types compile: `npm run typecheck --workspace=packages/types`
- [ ] Build succeeds: `npm run build --workspace=plugins/plugin-redux`
