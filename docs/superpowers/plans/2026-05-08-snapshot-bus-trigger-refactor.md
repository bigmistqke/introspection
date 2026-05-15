# Snapshot bus trigger refactor

> **Status:** in-flight (queued — `plugin-web-storage` and `plugin-indexeddb` shipped 2026-05-08, this is unblocked but not yet started)

Follow-up work to pick up **after** `plugin-web-storage` and `plugin-indexeddb` ship.

## Motivation

Today the bus trigger story for snapshots is inconsistent:

- `BusPayloadMap` declares a `'snapshot'` trigger with `{ trigger: 'manual' | 'js.error' | 'debugger.paused' }`, but nothing actually emits it.
- Plugins that want snapshots-on-event (`plugin-webgl`, `plugin-solid-devtools`) instead subscribe to three separate triggers — `'manual'`, `'js.error'`, `'detach'` — and duplicate the same snapshot logic in each handler.
- Whether js.error / detach should trigger a snapshot is a **policy decision** that today every plugin author re-litigates inline, rather than a config the user controls once.

## Proposal

1. **Rename `'manual'` bus trigger to `'snapshot'`.** Manual snapshots and lifecycle-induced snapshots are the same conceptual event — a request for plugins to dump current state — so there should be one trigger name.

2. **Each plugin subscribes to `'snapshot'` only.** Plugins stop listening to `'js.error'` / `'detach'` for snapshot purposes. One handler per plugin, one place where the snapshot logic lives.

3. **Snapshot fan-out is configured in `attach(...)`.** The runtime decides which lifecycle events fan out to a `'snapshot'` emit, based on user config. Strawman:

   ```ts
   attach(page, {
     plugins: [...],
     snapshotOn: ['js.error', 'detach'],  // default; opt out as needed
   })
   ```

   The runtime listens for those lifecycle events internally and emits `'snapshot'` on the bus. Plugins never need to know which lifecycle event triggered the snapshot — they just snapshot.

## Migration

- Update `BusPayloadMap`: remove the per-trigger payloads that exist only to feed snapshots; keep `'snapshot'` with a `{ trigger: 'manual' | 'js.error' | 'detach' | 'debugger.paused'; timestamp }` payload so handlers can still discriminate if they want to.
- Migrate `plugin-webgl`, `plugin-solid-devtools`, `plugin-web-storage`, `plugin-indexeddb` (once they exist), and any others to a single `bus.on('snapshot', ...)` handler.
- `plugin-redux` should also start subscribing — it currently only snapshots at store init, missing js.error / manual snapshots entirely.
- Add the `snapshotOn` (name TBD) option to `attach()` with a sensible default.

## Why defer

The current convention works (webgl/solid prove it), and the duplication is small. Doing this refactor before two more plugins land just means two more migrations. Land `plugin-web-storage` and `plugin-indexeddb` following the existing webgl/solid pattern, then refactor all snapshot-emitting plugins at once.
