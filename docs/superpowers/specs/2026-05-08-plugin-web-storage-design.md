# `plugin-web-storage` — Design

> **Status:** landed (2026-05-08) · plan: `docs/superpowers/plans/2026-05-08-plugin-web-storage.md`

Captures `localStorage` and `sessionStorage` activity (writes always, reads opt-in, plus snapshots) into the introspection trace.

Sibling plugin `plugin-indexeddb` is planned separately and is **not** covered here.

## Why

Today, debugging "what was in storage when this happened?" requires `console.log` instrumentation or manual `evaluate()` calls in tests. A first-class plugin makes storage state queryable via `introspect events --type 'webStorage.*'` like every other capture concern.

`plugin-web-storage` follows the existing primitive-capture pattern (`plugin-network`, `plugin-console`) — one focused plugin per browser concern, server-side via CDP where possible.

## Scope

In scope:
- `localStorage` and `sessionStorage` — covered together because they share the W3C "Web Storage" spec (same API, different lifetime).

Out of scope (separate plugins / future work):
- IndexedDB — separate `plugin-indexeddb` spec.
- Cookies — likely a future `plugin-cookies` plugin.
- Cache Storage / Service Worker — likely a future `plugin-cache-storage`.
- HTTP disk/memory cache — already exposed via `plugin-network` response flags.

## Public API

```ts
import { webStorage } from '@introspection/plugin-web-storage'

attach(page, {
  plugins: [webStorage({ reads: true })],
})
```

Options:

```ts
interface WebStorageOptions {
  /** Which Web Storage areas to capture. Default: both. */
  stores?: Array<'localStorage' | 'sessionStorage'>

  /**
   * Capture `getItem` reads. Off by default — reads are high-volume on hot
   * paths and require an init script (small page-side cost). Writes and
   * snapshots are always captured.
   */
  reads?: boolean

  /**
   * Restrict capture to specific origins. Default: top-frame origin only,
   * matching `plugin-network`'s default. Useful for ignoring noise from
   * embedded third-party iframes.
   */
  origins?: string[]

  verbose?: boolean
}
```

Defaults are deliberately conservative: writes + snapshots, both stores, top-frame origin only, no reads.

## Event schema

Three event types, added to `@introspection/types`:

```ts
export interface WebStorageWriteEvent extends BaseEvent {
  type: 'webStorage.write'
  metadata: {
    storageType: 'localStorage' | 'sessionStorage'
    operation: 'set' | 'remove' | 'clear'
    origin: string                  // serialized SecurityOrigin
    key?: string                    // present for 'set' and 'remove'
    oldValue?: string               // present for 'set' (when overwriting) and 'remove'
    newValue?: string               // present for 'set'
    clearedKeys?: string[]          // present for 'clear' — keys that existed at clear time
  }
}

export interface WebStorageReadEvent extends BaseEvent {
  type: 'webStorage.read'
  metadata: {
    storageType: 'localStorage' | 'sessionStorage'
    origin: string
    key: string
    value: string | null            // null = key absent (matches getItem())
  }
}

export interface WebStorageSnapshotEvent extends BaseEvent {
  type: 'webStorage.snapshot'
  metadata: {
    trigger: 'install' | 'manual' | 'js.error' | 'detach'
    origin: string
    localStorage?: Record<string, string>   // present iff opted into
    sessionStorage?: Record<string, string> // present iff opted into
  }
}
```

Notes:
- `value: string | null` on reads matches `Storage.prototype.getItem()` exactly. Web Storage coerces every set value to string, so `null` unambiguously means "key not present" — there's no "stored a literal `null`" ambiguity (that would round-trip as the string `"null"`).
- Snapshot payloads are **inline** in `metadata`. Web Storage values are typically small (apps store config blobs, feature flags, draft state) and inline keeps `introspect events` queries direct. A future generic inline-vs-asset threshold helper is sketched at `docs/superpowers/plans/2026-05-08-event-payload-size-threshold.md`; until that lands, this plugin stays inline.
- One snapshot event per origin captured — multi-origin pages get multiple snapshot events per trigger.

## Capture mechanism

All ongoing capture happens **page-side** by patching `Storage.prototype`, with a single CDP-side query at install time for the initial snapshot. Single channel = single clock = no cross-channel ordering issues.

### Page-side prototype patching (writes + reads)

Installed via `page.addInitScript(...)` so it runs before any page script in every frame. Pseudocode:

```js
(function() {
  const origGetItem    = Storage.prototype.getItem
  const origSetItem    = Storage.prototype.setItem
  const origRemoveItem = Storage.prototype.removeItem
  const origClear      = Storage.prototype.clear

  function storageType(self) {
    if (self === window.localStorage)   return 'localStorage'
    if (self === window.sessionStorage) return 'sessionStorage'
    return null  // unrecognised Storage instance — bail
  }

  function emit(payload) {
    window.__introspection_plugin_web_storage(JSON.stringify({
      ...payload,
      timestamp: performance.now(),  // source timestamp
    }))
  }

  Storage.prototype.setItem = function(key, value) {
    const oldValue = origGetItem.call(this, key) ?? undefined
    const result = origSetItem.call(this, key, String(value))
    const t = storageType(this)
    if (t) emit({ kind: 'write', op: 'set', storageType: t, key,
                  oldValue, newValue: String(value) })
    return result
  }

  Storage.prototype.removeItem = function(key) {
    const oldValue = origGetItem.call(this, key) ?? undefined
    const result = origRemoveItem.call(this, key)
    const t = storageType(this)
    if (t && oldValue !== undefined) emit({ kind: 'write', op: 'remove',
                                            storageType: t, key, oldValue })
    return result
  }

  Storage.prototype.clear = function() {
    const t = storageType(this)
    let keys = []
    if (t) {
      // capture keys before clearing so 'clear' events list what was removed
      for (let i = 0; i < this.length; i++) keys.push(this.key(i))
    }
    const result = origClear.call(this)
    if (t) emit({ kind: 'write', op: 'clear', storageType: t, clearedKeys: keys })
    return result
  }

  // Reads — only installed when options.reads === true (a flag is baked into
  // the script at install time on the server side).
  if (READS_ENABLED) {
    Storage.prototype.getItem = function(key) {
      const value = origGetItem.call(this, key)
      const t = storageType(this)
      if (t) emit({ kind: 'read', storageType: t, key, value })
      return value
    }
  }
})()
```

The script reaches the plugin via a single CDP `Runtime.addBinding` named `__introspection_plugin_web_storage`. Server-side handles `Runtime.bindingCalled`, parses the JSON, and emits the appropriate event type.

### Why page-side for everything (not CDP `DOMStorage`)

- **Single timestamp source.** Every event carries a `performance.now()` from the moment of the operation, mapped through `ctx.timestamp`. Reads, writes, and clears are mutually orderable to sub-microsecond precision regardless of CDP delivery latency.
- **`clear()` lists the cleared keys.** CDP's `domStorageItemsCleared` only signals that a clear happened; it doesn't enumerate what was removed. Page-side, we read `length` + `key(i)` before calling the original `clear()`.
- **One mental model.** The whole plugin is one init script + one binding. No mixing of CDP event subscriptions with page-side bindings.

What we give up vs. CDP `DOMStorage` capture: practically nothing in a real Playwright test. Because `addInitScript` runs before any page script, every realistic call path hits our wrapper. The one theoretical gap (realm-crossing via non-navigating iframes) applies to *every* prototype-patching plugin in this repo — see [`docs/prototype-patching-limits.md`](../../prototype-patching-limits.md). The plugin README links there rather than restating the explanation.

The standard prototype-patching caveats apply: `Storage.prototype.setItem.toString()` no longer returns `[native code]`. We don't try to hide this. Same risk profile as `plugin-redux`'s devtools-extension globals — accepted there, accepted here.

### Install-time snapshot — server-side via CDP

For the install snapshot specifically, we still use CDP:

```
const { entries } = await cdpSession.send('DOMStorage.getDOMStorageItems', {
  storageId: { securityOrigin, isLocalStorage }
})
```

This avoids racing the page's first scripts. A page that writes during inline `<script>` execution would have those writes captured by our prototype patch (init scripts run *before* page scripts), but the *initial* contents already on disk from a prior trace need a server-side dump. Snapshots triggered later (manual / js.error / detach) can use the same CDP query for consistency.

We do **not** subscribe to `DOMStorage.domStorageItem*` events for ongoing writes — the page-side wrapper is authoritative.

### Bus subscriptions for snapshots

Following the `plugin-webgl` / `plugin-solid-devtools` pattern:

```ts
ctx.bus.on('manual',   () => emitSnapshot('manual'))
ctx.bus.on('js.error', () => emitSnapshot('js.error'))
ctx.bus.on('detach',   () => emitSnapshot('detach'))
```

Plus an `install`-trigger snapshot emitted at the end of `install()` so traces are self-contained from frame zero.

A future refactor unifies these into a single `'snapshot'` bus trigger configured at attach time — see `docs/superpowers/plans/2026-05-08-snapshot-bus-trigger-refactor.md`. We follow today's convention now and migrate later.

## Origin filtering

Default behaviour: capture only the top-frame origin (the page under test). Implementation:

1. Track top-frame origin as it changes — listen to `Page.frameNavigated` for the main frame and update an internal `currentTopOrigin`.
2. Drop CDP write events whose `storageId.securityOrigin` doesn't match `currentTopOrigin` (or the configured `origins` list).
3. Snapshots iterate only the configured origin set.

This mirrors `plugin-network`'s default of focusing on first-party traffic, and the `origins?: string[]` escape hatch lets users opt iframes in.

## Package layout

```
plugins/plugin-web-storage/
├── package.json          // name: @introspection/plugin-web-storage
├── playwright.config.ts  // copies sibling plugin patterns
├── README.md
├── src/index.ts          // exports webStorage(options)
├── test/
│   └── *.spec.ts         // Playwright integration tests
└── tsconfig.json
```

Mirrors the existing `plugins/plugin-*` shape exactly. No deviations.

## Testing

Playwright integration tests against a local fixture page that:
- writes to localStorage and sessionStorage on load → assert snapshot at install captures both
- mutates after load (set/remove/clear) → assert one `webStorage.write` per mutation with correct `oldValue`/`newValue`
- (with `reads: true`) calls `getItem` → assert one `webStorage.read` per call, including a hit and a miss (`value: null`)
- triggers a thrown error → assert a `webStorage.snapshot` event with `trigger: 'js.error'` is emitted
- writes from an iframe with a different origin → assert event filtering works (default: dropped; with `origins: [iframeOrigin]`: captured)
- calls `handle.snapshot()` → assert a `webStorage.snapshot` event with `trigger: 'manual'`

Test layout copies `plugin-network`'s.

## Risks / open questions

- **Realm-crossing bypass via non-navigating iframes** — the one gap shared by all prototype-patching plugins. Documented at [`docs/prototype-patching-limits.md`](../../prototype-patching-limits.md). README of this plugin links there.
- **Per-write `getItem` cost on `setItem`/`removeItem`.** To populate `oldValue`, the wrapper reads the old value before mutating. This adds one storage read per write. Web Storage reads are cheap (~µs), so the impact is negligible.
- **`clear()` and key enumeration.** We snapshot keys via `length` + `key(i)` before the original `clear()` runs. If the page mutates storage between our key read and the clear (e.g. another patched `clear` from a different lib), the listed keys could drift. Same-thread JS makes this a non-issue in practice.
- **Top-frame origin tracking edge cases.** SPAs with `history.pushState` don't trigger `Page.frameNavigated`. Origin doesn't change in that case (same-origin navigation), so it's fine. Cross-origin top-frame navigations are rare and `Page.frameNavigated` fires for them.

## Related work

- `docs/superpowers/plans/2026-05-08-snapshot-bus-trigger-refactor.md` — unify `manual`/`js.error`/`detach` into a single `'snapshot'` bus trigger configured at attach time.
- `docs/superpowers/plans/2026-05-08-event-payload-size-threshold.md` — generic inline-vs-asset payload helper, applicable here once it lands.
- A separate `plugin-indexeddb` spec will follow once this lands.
