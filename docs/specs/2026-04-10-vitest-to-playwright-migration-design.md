# Integration Tests: Vitest to Playwright Test Migration

## Goal

Migrate `services/integration-tests` from Vitest + raw Playwright to Playwright Test as the runner. Replace all custom observability (testLogger, __testLog, createGlobalPage logging) with introspection as the single source of truth for test artifacts and events.

## Context

The integration tests currently use Vitest as the test runner with Playwright for browser automation. Vitest usage is light — `vi.fn()` is used in the native/iOS platform settings for mocking channel functions, `inject()` passes the logs directory from globalSetup, and the custom `describe`/`it` wrappers implement bail-on-failure logic. The setup also relies on a global mutable page pattern and manual console/network/error logging in `createGlobalPage`.

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
- **`globalSetup`** — stays the same (kill stale chromium, log setup). Playwright Test supports `globalSetup` natively. The `provide`/`inject` pattern for `logsDirectory` becomes `process.env` since Playwright Test's globalSetup communicates via environment variables.
- **Reporters** — `CronitorReporter` ported to Playwright's `Reporter` interface (phase 2), then rewritten to read from introspection sessions (phase 3). JSON reporter maps directly.
- **`timeout`** — maps from `testTimeout`.
- **`fullyParallel: false`** — default, since suites are sequential by design.

### 2a-ii. `vi.fn()` replacement

The native/iOS platform settings (`platforms/app-ios/settings.ts`) use `vi.fn()` extensively (~30 calls) for mocking native channel functions. Since Playwright Test has no built-in mock function, replace with a lightweight mock utility — either a thin `createMock` wrapper or a library like `tinyspy`. The mock API surface used is minimal: just creating callable functions with spy semantics.

### 2b. Wrapper replacements (clean break, no shims)

| Vitest | Playwright Test |
|---|---|
| `describe(title, fn)` | `test.describe(title, fn)` |
| leaf describes (serial) | `test.describe(title, fn)` + `test.describe.configure({ mode: 'serial' })` |
| `it(title, fn)` | `test(title, fn)` |
| `expect` | `expect` from `@playwright/test` |
| `beforeAll`/`afterAll`/etc. | Same names from `@playwright/test` |

The custom `Scope`/bail logic in `util/vitest.ts` is removed entirely — `serial` mode handles this. The `onAfterIt` callback pattern is replaced by Playwright's `afterEach` (current usage is static registration at describe time, not dynamic runtime registration, so this is a direct replacement).

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

### 2f. Browser/context reuse

The current `createGlobalPage` deliberately reuses browser and context instances when parameters haven't changed, preserving the HTTP cache (JS bundles, locale catalogs). In Playwright Test, each worker gets its own browser. Context reuse can be achieved via worker-scoped fixtures. Initially, accept per-test context creation (Playwright default) and measure performance impact. If significant, add a worker-scoped context fixture that matches the current reuse logic. Storage clearing between tests (localStorage, sessionStorage, IndexedDB) is handled implicitly by fresh contexts; if context reuse is added, explicit clearing must be restored.

### 2g. Screenshot orchestration

The current `afterEach` in `logs/index.ts` does more than a simple screenshot:
- Takes light/dark mode paired screenshots when dark mode testing is enabled (switches `data-mode` attribute between shots)
- Writes screenshots to structured paths with step-indexed naming
- Appends entries to a `manifest.jsonl` for a test results viewer

With the proxy-based screenshot approach, the light/dark orchestration logic moves to a Playwright `afterEach` fixture that calls `page.screenshot()` twice (the proxy captures both to introspection assets). The manifest viewer is replaced by introspection's own session data — the `playwright.screenshot` events carry the titlePath and step metadata that the manifest currently provides.

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

## Phase 4: Integration tests viewer migration

The `services/integration-tests-viewer` currently reads `manifest.jsonl` and `meta.json` from the logs directory. Each manifest entry contains `{ path, name, suites, state, screenshot, viewport }` per test step. The viewer builds a tree (platform → suite → test steps), shows screenshots (with light/dark mode pairs), logs, and pass/fail state.

### 4a. Data source migration

The viewer's middleware (`middleware/index.ts`) currently:
- Reads `manifest.jsonl` via `parseManifest()` to get test entries
- Reads `meta.json` for run metadata (commit SHA, branch, timestamp, dirty flag, dark mode)
- Serves screenshot PNGs and log files from the logs directory

After migration, introspection sessions contain all this data:
- `events.ndjson` has `playwright.test.start` (with titlePath = suites), `playwright.result` (with state), `playwright.screenshot` (with asset path)
- `session.json` has session metadata (startedAt, label, plugins)
- Screenshots are in the session's `assets/` directory

The middleware needs to be rewritten to read introspection sessions instead of manifest/meta files.

### 4b. Data mapping

| manifest.jsonl field | Introspection equivalent |
|---|---|
| `path` | Derived from `titlePath` in `playwright.test.start` event |
| `name` | Last element of `titlePath` |
| `suites` | `titlePath` array (minus root empty string and leaf test name) |
| `state` | `status` field in `playwright.result` event (`passed`→pass, `failed`→fail) |
| `screenshot` | `path` field in `playwright.screenshot` event |
| `viewport` | Can be read from `page.viewportSize()` — add to screenshot event metadata |

| meta.json field | Introspection equivalent |
|---|---|
| `commitSha` | Add to session metadata at attach time (read from git) |
| `branch` | Add to session metadata at attach time |
| `timestamp` | `session.json` `startedAt` |
| `dirty` | Add to session metadata at attach time |
| `dm` | Configuration flag — add to session metadata or derive from presence of dark-mode screenshot events |

### 4c. Viewer changes

The viewer frontend (`src/`) currently consumes the `Job`, `Platform`, `Suite`, `Test` types built from manifest data. The types and tree-building logic (`tree.ts`) stay structurally the same — they just get populated from introspection data instead of manifest parsing. The `parseManifest` and `parseMeta` utilities in `logs/parse.ts` get replaced with an introspection session reader.

### 4d. Logs panel

The viewer currently serves `.log` files (pino JSON logs) alongside screenshots. After migration, the equivalent is the `events.ndjson` for each session. The viewer's log panel should display introspection events instead — this is a richer data source (typed events with timestamps vs raw pino lines).

---

## Acceptance criteria

- **Phase 1**: New introspection features (proxy writeAsset, titlePath events, plugin-redux) have passing tests in the introspection repo.
- **Phase 2**: All existing test files run under `npx playwright test` with the same pass/fail results as `vitest run`.
- **Phase 3**: `createGlobalPage` contains no logging/observability code. `testLogger` is removed. All test artifacts (screenshots, logs, events) are in introspection session directories.
- **Phase 4**: The integration-tests-viewer reads from introspection sessions. `manifest.jsonl` and `meta.json` are no longer produced. The viewer shows the same information (screenshots, pass/fail, tree navigation) but backed by introspection data.

---

## Dropped concerns

- **Playwright internal debug logger hook** — `createGlobalPage` monkey-patches Playwright's internal `debugLogger` to capture actionability logs (locator resolution, retries). This is fragile and not worth migrating. Playwright Test's built-in tracing (`--trace on`) provides equivalent or better actionability debugging.
- **Fetch abort filtering** — the current fetch wrapper in `addInitScript` filters out intentionally aborted requests before logging. The CDP-based `plugin-network` does not have this filtering. The additional noise is acceptable; if not, a filter option can be added to `plugin-network` later.

---

## Decisions made

- **Keep suite-as-function pattern** — minimize diff, defer projects-based platform matrix
- **Clean break on renames** — no `describe`/`it` compatibility wrappers
- **Leaf describes use `serial` mode** — explicit opt-in via `test.describe.configure({ mode: 'serial' })`
- **Proxy extension for screenshots** — no plugin needed, proxy intercepts `page.screenshot()` and writes assets
- **`__introspect_push__` as escape hatch** — for ad-hoc browser-to-introspection communication that doesn't warrant a plugin
- **Introspection as single source of truth** — all test artifacts, events, and observability flow through introspection
