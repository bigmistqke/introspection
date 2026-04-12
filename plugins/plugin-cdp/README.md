# @introspection/plugin-cdp

Captures every CDP command and event crossing the shared session — a raw wire trace for debugging other plugins.

Useful for understanding the exact sequence and parameters of Chrome DevTools Protocol calls made by other plugins, diagnosing timing races, or replaying bugs from the CDP trace alone. Install first in the plugins array so its tap is in place before other plugins run.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [Options](#options)
- [What it captures](#what-it-captures)
- [Caveats](#caveats)
- [When to reach for it](#when-to-reach-for-it)

## Install

```bash
pnpm add -D @introspection/plugin-cdp
```

## Usage

```ts
import { attach } from '@introspection/playwright'
import { cdp } from '@introspection/plugin-cdp'
import { network } from '@introspection/plugin-network'

// Install plugin-cdp FIRST so its tap is in place before other plugins
// issue any CDP commands.
const handle = await attach(page, { plugins: [cdp(), network()] })
```

## Options

```ts
cdp({
  verbose: true,
  captureResults: false,
  filter: (method) => method.startsWith('Network.') || method.startsWith('Page.'),
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `verbose` | `boolean` | `false` | Log each captured command/event to stdout via `createDebug('plugin-cdp')`. |
| `captureResults` | `boolean` | `true` | Include resolved command results in `cdp.command.metadata.result`. Set to `false` to drop potentially large payloads (Runtime.evaluate return values, network bodies). Errors are always captured. |
| `filter` | `(method: string) => boolean` | `undefined` | Return `true` for methods you want captured. Applied to both commands and events. Narrow aggressively for long runs — an unfiltered trace on a real page is large. |

## What it captures

| Event type | Trigger |
|---|---|
| `cdp.command` | Every outgoing CDP command, fired once the command resolves. Metadata includes `method`, `params`, `result` (or `error`), and `durationMs`. |
| `cdp.event` | Every incoming CDP event, fired as it arrives. Metadata includes `method` and raw `params`. |

Because this is a wildcard tap, every CDP method appears — `Network.*`, `Runtime.*`, `Page.*`, `Debugger.*`, `Fetch.*`, etc. Use the `filter` option to narrow.

## Caveats

### Install order matters

`plugin-cdp` installs its tap by monkey-patching `cdp.send` and `cdp.emit` on the shared `CDPSession`. Any plugin installed **before** `plugin-cdp` will have its send calls bypass the tap (because those plugins hold bound references to the pre-patched send). Put `cdp()` first in the `plugins` array.

### Framework-internal commands are not captured

`attach()` issues a handful of commands during setup — `Runtime.enable`, `DOM.enable`, `Page.enable`, `Runtime.addBinding` — before any plugin's `install()` runs. Those fire before the tap exists and will not appear in the trace. Commands issued after attach completes (including from within `handle.flush()`) *are* captured.

### Trace size

A non-trivial page can easily produce thousands of CDP messages. Defaults keep full `result` payloads on `cdp.command`, which includes things like `Runtime.evaluate` return values and `Network.getResponseBody` contents. For long test runs or large responses, either set `captureResults: false` or narrow via `filter`.

### Shared-session mutation

`plugin-cdp` mutates the `CDPSession` that every other plugin uses. That's how the tap sees other plugins' calls. If you need a second CDP instrumentation plugin, write it to compose with `plugin-cdp` (subscribe to its `cdp.command` / `cdp.event` events via `ctx.bus`) rather than double-patching.

## When to reach for it

- **"Why did plugin X emit the wrong thing?"** — see the exact CDP params it received.
- **Timing races** — e.g. calling `Network.getResponseBody` before `loadingFinished` fires. A `cdp.event` / `cdp.command` trace makes the ordering immediately visible without ad-hoc `debug()` sprinkles.
- **Replay without the browser** — the trace is pure data, so a bug can be reproduced from the ndjson file alone.
