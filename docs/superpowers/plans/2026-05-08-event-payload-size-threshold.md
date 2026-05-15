# Generic inline-vs-asset payload threshold

Follow-up idea — not blocking any specific plugin. Worth picking up once we have 2+ plugins facing the "is this payload too big to inline?" question.

## Problem

Plugins that emit snapshots or otherwise large-ish payloads currently make a per-plugin choice:

- `plugin-redux` always writes state to a JSON asset (state trees can be huge).
- `plugin-web-storage` (planned) will inline its snapshot in event metadata (typically small).
- Future plugins (e.g. `plugin-indexeddb`, cache storage) will face the same question and likely re-litigate it.

The right answer is usually **inline below a threshold, asset above it** — small payloads stay queryable without an asset round-trip; large ones don't bloat `events.ndjson`. Today every plugin reimplements that logic (or skips the cutoff entirely).

## Proposal

Add a generic helper on `PluginContext` that handles the cutoff:

```ts
// strawman
const ref = await ctx.emitPayload(value, {
  inlineUnder: 32_000,  // bytes; default from trace config
  kind: 'json',
})
// ref is either { inline: value } or { assets: [assetRef] }
```

Plugins compose it into their event:

```ts
const payload = await ctx.emitPayload(snapshot)
await ctx.emit({ type: 'webStorage.snapshot', ...payload })
```

The trace-level default lives in `attach()` config so users can tune it once for the whole trace (e.g. raise it for offline analysis, lower it for CI artifact size).

Open questions:
- Does the event schema need to express "this field may be inline or assetized"? Probably a discriminated union per event type, or a convention that `metadata.payload` and `assets[0]` are mutually exclusive for the same logical value.
- Reconstruction helpers (`introspect events`, query layer) should transparently resolve either form when a consumer reads the value.

## Why defer

`plugin-web-storage` payloads are nearly always small; inline is fine. Designing the generic helper now without a second concrete consumer risks getting the API wrong. Land `plugin-web-storage` (inline) and `plugin-indexeddb` (likely needs asset for object stores), then extract the shared pattern.
