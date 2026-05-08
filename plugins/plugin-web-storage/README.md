# @introspection/plugin-web-storage

Captures `localStorage` and `sessionStorage` activity (writes always, reads opt-in, plus snapshots) into the introspection trace.

The plugin patches `Storage.prototype` page-side via `addInitScript`, so every realistic call path — `localStorage.setItem(...)`, `Storage.prototype.setItem.call(...)`, DevTools console input — is captured. Snapshots of full storage state are emitted at install and on every bus trigger (`manual`, `js.error`, `detach`).

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [Options](#options)
- [Events emitted](#events-emitted)
- [How snapshots work](#how-snapshots-work)
- [Caveats](#caveats)

## Install

```bash
pnpm add -D @introspection/plugin-web-storage
```

## Usage

```ts
import { attach } from '@introspection/playwright'
import { webStorage } from '@introspection/plugin-web-storage'

const handle = await attach(page, {
  plugins: [
    webStorage(),                  // writes + snapshots only
    // webStorage({ reads: true }) // also captures every getItem
  ],
})
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `stores` | `('localStorage' \| 'sessionStorage')[]` | `['localStorage', 'sessionStorage']` | Which storage areas to capture. |
| `reads` | `boolean` | `false` | Capture every `getItem` call. Off by default — reads are high-volume on hot paths. |
| `origins` | `string[]` | `['*']` (all origins) | Restrict capture to specific origins. The literal `'*'` matches everything. |
| `verbose` | `boolean` | `false` | Verbose debug logs. |

## Events emitted

- `webStorage.write` — every `setItem` / `removeItem` / `clear`. Includes `oldValue` (for set/remove) and `newValue` (for set), or `clearedKeys` (for clear).
- `webStorage.read` — every `getItem`, only when `reads: true`. `value: null` indicates the key was absent (matches the browser API).
- `webStorage.snapshot` — full storage dump. `metadata.trigger` is one of `'install' | 'manual' | 'js.error' | 'detach'`.

## How snapshots work

Snapshots are queried server-side via CDP `DOMStorage.getDOMStorageItems`, so they capture state already on disk from prior sessions even if the page never touched it. They're emitted automatically at install and whenever the introspection runtime fires `manual`, `js.error`, or `detach` on the bus — no API to call.

## Caveats

The plugin captures by patching `Storage.prototype`. This is robust against every realistic call site, but has the same realm-crossing limitation as every prototype-patching plugin in this repo: see [`docs/prototype-patching-limits.md`](../../docs/prototype-patching-limits.md). In practice, no application code triggers it.

`Storage.prototype.setItem.toString()` no longer returns `[native code]` while the plugin is attached. The exceedingly rare apps that sniff this will see our wrapper.
