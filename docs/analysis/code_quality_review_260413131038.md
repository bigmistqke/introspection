# Code quality review — 2026-04-13

Audit conducted across four axes in parallel: type-safety & API consistency, plugin consistency, silent failures & error handling, build/tooling & dead code. Findings below are prioritised by impact, not by audit axis.

Overall the codebase is healthy. Consistent style across plugins, no dep drift to speak of, no TODO/FIXME sprawl, tests are real (no mocks). The issues below are clustered: silent failures are the dominant class, type-edge-casting is the second.

---

## High impact

### 1. Type assertions on CDP / plugin responses without validation

A recurring pattern: `const result = await cdp.send(...) as { body: string; base64Encoded: boolean }` — no check that `body` actually exists. When CDP returns an unexpected shape, fields become `undefined` and propagate silently.

- `plugins/plugin-network/src/index.ts:79` — `getResponseBody` cast without validation
- `plugins/plugin-react-scan/src/index.ts:49` — `getReport()` result cast without validating Map-vs-single-entry shape
- `plugins/plugin-debugger/src/index.ts:141-142` — fallback chain `?? ''` swallows location read failures
- `packages/playwright/src/attach.ts:74, 122` — `result.value as string` without confirming it's a string
- `packages/cli/src/commands/events.ts:46-52` — event metadata cast per-type; if an event lands without the expected fields, the formatter prints `undefined`

Fix pattern: a tiny `assertShape<T>(value, keys): asserts value is T` helper or per-event runtime validator.

### 2. NDJSON parsing has no error tolerance

`packages/read/src/index.ts:235` — `.map(line => JSON.parse(line))` throws on the first malformed line and aborts the entire `loadEvents` call. A single corrupted event line makes the whole trace unreadable. `docs/ideas.md` already notes the `\r\n` line-split issue; this is a separate, more severe one.

### 3. Missing event-type re-exports from plugins

Plugins define their event types in `packages/types/src/index.ts` via declaration merging (good), but the plugin packages don't re-export those types, so consumers can't narrow programmatically:

- `plugins/plugin-react-scan/src/index.ts` — no export of `ReactScanRenderEvent` / `ReactScanCommitEvent` / `ReactScanReportEvent`
- `plugins/plugin-debugger/src/index.ts` — no export of `DebuggerCaptureEvent`
- `plugins/plugin-solid-devtools/src/index.ts` — no export of its events
- `plugins/plugin-webgl/src/index.ts` — missing `WebGLCaptureEvent` re-export

One-liner per plugin: `export type { ReactScanRenderEvent, ... } from '@introspection/types'`.

### 4. `packages/utils/src/bus.ts:22` swallows handler errors via `Promise.allSettled`

Plugin bus handlers that throw are caught and discarded. A plugin subscribed to `js.error` that itself errors is invisible. Either log the rejections or propagate them — matches the broader "silent failures" class already in `docs/ideas.md`.

---

## Medium impact

### 5. `plugin-solid-devtools` missing `events` map

`plugins/plugin-solid-devtools/src/index.ts:54-56` — the `IntrospectionPlugin` return value has no `description` or `events` field. README documents three event types that aren't declared in code. `introspect plugins` can't show them.

### 6. Duplicated `readEvents` helper across ~10 test files

Verbatim copy of:

```ts
async function readEvents(outDir: string) {
  const entries = await readdir(outDir)
  const ndjson = await readFile(join(outDir, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}
```

— in every plugin's `test/*.spec.ts`, plus `packages/playwright/test/attach.spec.ts:20`. Strong candidate for a shared `@introspection/test-utils` package or an export from `@introspection/read`.

### 7. Dual-build plugin boilerplate

Three plugins (`plugin-performance`, `plugin-webgl`, `plugin-solid-devtools`) have near-identical `tsup.browser.config.ts` + `tsup.node.config.ts` setups with the same `iife` / `globalName` / `noExternal: [/.*/]` pattern. `plugin-react-scan` does it differently (single `tsup.config.ts` with two entries) and `plugin-debugger` has a third variation. A shared `defineBrowserPluginBuild()` or one canonical config pattern would reduce the surface area.

### 8. Dead export: `summariseBody` in `@introspection/utils`

`packages/utils/src/summarise-body.ts:3` exports `summariseBody()` — not imported anywhere in the workspace. Either delete or wire it into `plugin-network` / `plugin-debugger` (network body snippets would be a plausible caller).

### 9. `plugin-redux` uses `vite@^5.0.0`

Every other workspace uses `vite@^6.0.0`. Probably an accident. `plugins/plugin-redux/package.json:32`.

---

## Low impact / cleanup

- **Abbreviated variable names in catch blocks**: `packages/cli/src/commands/debug.ts:46,65` (`err`, `e`), `plugins/plugin-redux/src/index.ts:27` (`e`). CONTRIBUTING.md forbids these; simple find-replace.
- **`plugins: any[]`** in `packages/cli/src/commands/debug.ts:39` should be `IntrospectionPlugin[]`.
- **`plugin-defaults`** has `"test": "echo \"no tests\""` and no test directory. Intentional (meta-plugin returning an array), but worth a one-liner test that asserts the array shape.
- **`plugin-react-scan` README** doesn't follow the template (no `@introspection/` prefix in H1, no Install section before Events). `docs/PLUGIN_README_TEMPLATE.md` is the reference.
- **CDP handler signature**: `(params: unknown) => void` in `PluginContext` (`packages/types/src/index.ts:428`) forces every plugin to cast. A generic handler `<T>(params: T) => void` with a matching typed `on<K extends keyof CDPEventMap>(...)` overload would push the cast into the type system once.

---

## What's solid

- **No TODO / FIXME comments anywhere.**
- **No dep drift** in the tooling axis (typescript, tsup, vitest, @playwright/test all single-versioned).
- **Every plugin has `verbose` + `createDebug`** — the CONTRIBUTING.md rule is actually followed 11/11.
- **Every plugin has real Playwright tests** — no mocks, matches the "no mocking" principle.
- **Types centralised via `TraceEventMap` declaration merging** — the extension story for third-party plugins is clean.
- **Silent-failure list, CLI formatter gaps, etc.** are already tracked in `docs/ideas.md` — transparent backlog.

---

## Recommended priority order

1. Fix the NDJSON parse-any-line-kills-the-trace bug (#2) — one `try/catch` in a loop, high leverage.
2. Add event type re-exports (#3) — 4 one-liners, unblocks consumer narrowing.
3. Introduce a shared `readEvents` helper (#6) — delete 10 duplicates at once.
4. Bus error surfacing (#4) + CDP response shape validation (#1) — same class, worth doing together.
5. Tidy catch-block variable names + `any[]` (low impact).

---

**Big-picture take:** the quality gaps are architectural consistency issues, not "this code is bad" issues. The framework has a single style and follows it; where it deviates, it's mostly at boundaries (CDP types, consumer-facing exports, test scaffolding) — exactly the places where a tightening pass would pay off.
