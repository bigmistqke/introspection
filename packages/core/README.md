# @introspection/core

Internal utilities used by `@introspection/playwright`. Handles CDP event normalization, session file I/O, body summarization, and DOM/scope snapshots.

You generally don't need to use this directly — `@introspection/playwright` re-exports what you need. This package is documented for plugin authors and contributors.

## API

### Session I/O

```ts
import { initSessionDir, appendEvent, writeAsset, finalizeSession } from '@introspection/core'

await initSessionDir(outDir, { id, startedAt, label? })
await appendEvent(outDir, sessionId, event)
await writeAsset({ directory, name, kind, content, ext?, metadata, source? })
await finalizeSession(outDir, sessionId, endedAt)
```

`writeAsset` writes content to `assets/<uuid>.<kind>.<ext>` and appends an `asset` event to `events.ndjson`.

### CDP normalizers

```ts
import { normaliseCdpNetworkRequest, normaliseCdpNetworkResponse, normaliseCdpJsError } from '@introspection/core'

const event = normaliseCdpNetworkRequest(cdpParams, startedAt)   // → NetworkRequestEvent
const event = normaliseCdpNetworkResponse(cdpParams, startedAt)  // → NetworkResponseEvent
const event = normaliseCdpJsError(cdpParams, startedAt)          // → JsErrorEvent
```

### Snapshot

```ts
import { takeSnapshot } from '@introspection/core'

const snap = await takeSnapshot({ cdpSession, trigger, url, callFrames? })
// → { ts, trigger, url, dom, scopes, globals }
```

Captures `DOM.getOuterHTML` and evaluates `location.pathname`, `localStorage`, `sessionStorage` via CDP.

### Body summarization

```ts
import { summariseBody } from '@introspection/core'

const summary = summariseBody(rawJsonString)
// → { keys, scalars, arrays, errorFields }
```

Extracts a shallow summary of a JSON response body for indexing in events.
