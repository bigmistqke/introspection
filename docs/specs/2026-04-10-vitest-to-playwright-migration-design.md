# Integration Tests: Vitest to Playwright Test Migration

## Goal

Migrate `services/integration-tests` from Vitest + raw Playwright to Playwright Test as the runner. Replace all custom observability (testLogger, __testLog, createGlobalPage logging) with introspection as the single source of truth for test artifacts and events.

## Context

The integration tests currently use Vitest as the test runner with Playwright for browser automation. Vitest provides almost nothing here — no mocking, no inject, no snapshots. The setup includes heavy custom wrappers around `describe`/`it` (bail-on-failure logic), a global mutable page pattern, and manual console/network/error logging in `createGlobalPage`.

Playwright Test provides all of this natively (serial mode, fixtures, testInfo with titlePath), and the introspection fixture integrates directly.

## Approach: Incremental, introspection-first

Build missing introspection pieces first, then migrate the runner, then swap the observability layer.

---

## Phase 1: Introspection changes

### 1a. Proxy extension for artifact-producing methods

`proxy.ts` currently only emits events. Extend it to also accept `writeAsset` so it can handle methods that produce artifacts.

`screenshot` gets special treatment:
- Intercepts `page.screenshot()`, calls the original, saves the buffer via `writeAsset` to the session's assets directory
- Emits a `playwright.screenshot` event with the asset path as metadata
- Returns the buffer to the caller unchanged

`attach.ts` passes `writeAsset` into `createPageProxy` alongside `emit`.

New event type: `PlaywrightScreenshotEvent` with data `{ path: string, timestamp: number }`.

### 1b. Test lifecycle events with titlePath

The `introspectFixture` gets access to `testInfo.titlePath`. Two events:

- **`playwright.test.start`** — emitted at the beginning of the fixture (before `use()`), carries `{ titlePath: string[] }`
- **`playwright.result`** — already exists, extend its data to also carry `titlePath: string[]` alongside `status`, `duration`, `error`

This gives every session a pair of bracketing events per test, with the full describe chain.

### 1c. `plugin-redux`

New plugin for capturing store dispatches. Browser-side script that hooks into the store's dispatch/middleware. Pushes structured events via `__introspect_push__`:

- Event type: `redux.dispatch`
- Data: `{ action: string, payload: unknown, stateBefore?: unknown, stateAfter?: unknown }`
- State diffs are opt-in (can be expensive)

Replaces the `__testLog` usage in `services/frontend/src/store/logger.ts`.

---

## Phase 2: Runner migration (Vitest to Playwright Test)

### 2a. `playwright.config.ts`

Replaces `vitest.config.ts`. Key settings:

- **Projects** — one per platform directory (`browser-desktop`, `browser-mobile`, etc.). Since we keep the suite-as-function pattern, projects just point to the test files under each `platforms/` directory.
- **Workers** — maps from `pool: 'forks'` / `maxWorkers`.
- **`globalSetup`** — stays the same (kill stale chromium, log setup). Playwright Test supports `globalSetup` natively.
- **Reporters** — `CronitorReporter` ported to Playwright's `Reporter` interface. JSON reporter maps directly.
- **`timeout`** — maps from `testTimeout`.
- **`fullyParallel: false`** — default, since suites are sequential by design.

### 2b. Wrapper replacements (clean break, no shims)

| Vitest | Playwright Test |
|---|---|
| `describe(title, fn)` | `test.describe(title, fn)` |
| leaf describes (serial) | `test.describe(title, fn)` + `test.describe.configure({ mode: 'serial' })` |
| `it(title, fn)` | `test(title, fn)` |
| `expect` | `expect` from `@playwright/test` |
| `beforeAll`/`afterAll`/etc. | Same names from `@playwright/test` |

The custom `Scope`/bail logic in `util/vitest.ts` is removed entirely — `serial` mode handles this. The `onAfterIt` callback pattern is replaced by Playwright's `afterEach`.

All renames are mechanical — no compatibility wrappers.

### 2c. `global.page` to fixture

`createGlobalPage` becomes a Playwright fixture providing `page` with mock dates and flag injection applied. The `introspectFixture` wraps it, so tests get the proxied page.

For this phase, the fixture temporarily retains the console/request logging from `createGlobalPage`. That moves to introspection plugins in phase 3.

### 2d. Test file changes

Test files remain minimal. Suite files get mechanical renames: `describe` to `test.describe`, `it` to `test`, `global.page` to fixture-provided page. `TestSettings.createPage` is replaced by fixture configuration.

### 2e. Test structure semantics (preserved)

The test structure is intentional and preserved:
- `test.describe` blocks nest to describe context/metadata
- The leaf `test.describe` describes a scenario (configured with `mode: 'serial'`)
- Each `test()` is a single action within the scenario
- After each action, a screenshot is taken via the proxied `page.screenshot()`

---

## Phase 3: Observability migration

### 3a. Replace `createGlobalPage` logging with introspection plugins

The introspect fixture installs:

| Concern | Plugin |
|---|---|
| Console capture | `plugin-console` (exists) |
| Request/response logging | `plugin-network` (exists) |
| Page errors | `plugin-js-error` (exists) |
| Store dispatches | `plugin-redux` (new, phase 1c) |
| Screenshots | Proxy extension (phase 1a) |

`createGlobalPage` is gutted to only:
- Browser launch config (headless, args, window size)
- Context config (device, user agent, JS enabled, scale factor, HTTP headers, reduced motion)
- Mock date injection via `addInitScript`
- Flag injection via `addInitScript` (`RG_FAST`, `RG_DEBUG`, etc.)

All `.on('console')`, `.on('request')`, `.on('response')`, `.on('pageerror')`, `.on('framenavigated')` handlers are removed.

### 3b. Frontend cleanup

- Remove `__testLog` calls from `logger.ts` — replaced by `plugin-redux`
- Remove `__testLog` calls from `emitter.ts` — app events use `__introspect_push__` if still wanted, or are captured by `plugin-console` via the existing `console.log`
- Remove `__testLog` type declarations from `window.d.ts` and `index.d.ts`
- Remove the fetch wrapper from `createGlobalPage`'s `addInitScript` — `plugin-network` covers this via CDP

### 3c. `testLogger` and `CronitorReporter`

`testLogger` is removed entirely. Introspection's `events.ndjson` is the single source of truth.

`CronitorReporter` is rewritten to read from introspection sessions rather than `testLogger`.

---

## Decisions made

- **Keep suite-as-function pattern** — minimize diff, defer projects-based platform matrix
- **Clean break on renames** — no `describe`/`it` compatibility wrappers
- **Leaf describes use `serial` mode** — explicit opt-in via `test.describe.configure({ mode: 'serial' })`
- **Proxy extension for screenshots** — no plugin needed, proxy intercepts `page.screenshot()` and writes assets
- **`__introspect_push__` as escape hatch** — for ad-hoc browser-to-introspection communication that doesn't warrant a plugin
- **Introspection as single source of truth** — all test artifacts, events, and observability flow through introspection
