# `@introspection/config` — design spec

**Status:** draft
**Date:** 2026-04-23
**Scope:** extract config loading + plugin preset resolution into a new package; keep `attach()` a pure primitive; wire the CLI to consume the package.

## Motivation

`@introspection/playwright`'s `attach()` and `@introspection/cli`'s debug command both need to load an `introspect.config.{ts,js,mts,mjs}` and resolve which plugins to activate. Today:

- The CLI has ad-hoc `await import(configPath)` with its own fallback logic.
- `attach()` grew a `cwd` option in an earlier iteration so it could walk up and auto-load config, but ambient filesystem side effects on a low-level primitive caused breakage in intra-package tests (`proxy.spec.ts`) and felt like a layering violation.

Both consumers want the same thing — find the nearest config, apply preset rules, hand back a plugin array — so it belongs in a shared package between `@introspection/types` and its consumers. This keeps `attach()` a primitive and lets the CLI get preset-env-var support for free.

## Architecture

```
@introspection/types      ← IntrospectConfig, PluginSet, IntrospectionPlugin
         ↑
@introspection/config     ← loadIntrospectConfig, resolvePlugins, loadPlugins
         ↑
    ┌────┴────┐
playwright   cli          ← both consume @introspection/config
```

`attach()` takes `plugins: IntrospectionPlugin[]` only. It never touches the filesystem for config discovery. Callers that want config-backed plugins call `loadPlugins()` (or the two-step `loadIntrospectConfig` + `resolvePlugins`) themselves.

## Public API (`@introspection/config`)

### `loadIntrospectConfig(opts?) => Promise<IntrospectConfig | undefined>`

Pure loader.

```ts
interface LoadConfigOptions {
  cwd?: string       // default: process.cwd()
  configPath?: string  // explicit path, skips discovery
}
```

- With `configPath`: `stat()` the path (ENOENT errors surface as-is), then `import(pathToFileURL(path))`, return `mod.default ?? mod`.
- Without `configPath`: walk up from `cwd` looking for `introspect.config.{ts,mts,js,mjs}` (in that order). Return the first match imported; return `undefined` if nothing found.
- Uses native `import()` (Node 24+), matching the existing CLI pattern. No jiti.

### `resolvePlugins(args) => IntrospectionPlugin[]`

Pure precedence logic. Throws on error cases.

```ts
interface ResolvePluginsArgs {
  optsPlugins?: IntrospectionPlugin[]
  config?: IntrospectConfig
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
}
```

Precedence (high → low):
1. `optsPlugins` if provided — returned verbatim, env/config ignored.
2. `env.INTROSPECT_PRESET` (trimmed, empty treated as unset) — split on `,`, look up each in the config's preset object; merge arrays in order.
3. Array-form config (`plugins: [...]`) — returned verbatim only if no env preset is set.
4. Object-form config's `default` preset.
5. `[]`.

Errors:
- `INTROSPECT_PRESET` set but no config loaded → throw.
- `INTROSPECT_PRESET` set while config uses array form → throw, suggest the preset-object migration.
- Unknown preset name (including one of a comma-list) → throw with available names.

### `loadPlugins(opts?) => Promise<IntrospectionPlugin[]>`

Sugar combining the two for the common case.

```ts
interface LoadPluginsOptions {
  cwd?: string           // default: process.cwd()
  configPath?: string    // default: undefined (discovery)
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>  // default: process.env
  optsPlugins?: IntrospectionPlugin[]  // passthrough override
}
```

Implementation:
```ts
const config = await loadIntrospectConfig({ cwd, configPath })
return resolvePlugins({ optsPlugins, config, env })
```

### Re-exports for consumer convenience

```ts
export type { IntrospectConfig, PluginSet } from '@introspection/types'
```

## Package scaffolding

Mirrors `@introspection/utils` (tsup + vitest + workspace dep on types).

```
packages/config/
  package.json          — name "@introspection/config", deps: @introspection/types workspace:*
  tsconfig.json
  tsup.config.ts
  src/
    index.ts            — re-exports
    resolve.ts          — resolvePlugins (pure)
    load.ts             — loadIntrospectConfig
    plugins.ts          — loadPlugins (sugar)
  test/
    resolve.test.ts     — 10 pure-resolver tests
    load.test.ts        — 5 loader tests
    plugins.test.ts     — 2–3 end-to-end "sugar" tests
    fixtures/
      config-array/introspect.config.ts
      config-presets/introspect.config.ts
      config-presets/nested/dir/marker.txt
```

Test runner: **vitest** (matches `@introspection/utils` and other non-Playwright packages). No browser needed.

## Consumer changes

### `@introspection/playwright`

- Remove `packages/playwright/src/config.ts` (move contents to `@introspection/config`).
- Remove `packages/playwright/test/config.spec.ts`, `config-loader.spec.ts`, `attach-config.spec.ts`, and `test/fixtures/` (move test coverage to `@introspection/config`).
- Revert `AttachOptions`: drop `cwd`, restore `const plugins = options.plugins ?? []` in `attach()`.
- Add `"@introspection/config": "workspace:*"` to `package.json`.
- `src/index.ts` re-exports `loadPlugins`, `loadIntrospectConfig`, `resolvePlugins` and related types from `@introspection/config` so fixture users only need one import.

### `@introspection/cli`

- Add `"@introspection/config": "workspace:*"` to `package.json`.
- In `src/commands/debug.ts`, replace the existing `await import(configPath)` block with a call to `loadIntrospectConfig({ configPath })` (CLI currently accepts explicit `--config`; keep that semantics).
- Keep the CLI's existing "config is optional; empty plugins if missing" behavior: if `opts.config` was explicitly passed, propagate load errors; otherwise fall back to `{ plugins: [] }`.
- Out of scope: exposing `INTROSPECT_PRESET` to the CLI as a flag — but the env var works automatically because the resolver picks it up. No CLI code needed for that.

## Error shapes (stable, no changes)

- `Unknown preset "xyz". Available presets: default, network, …`
- `INTROSPECT_PRESET="xyz" is set, but introspect config uses array form — presets are not defined. Change config to { plugins: { default: [...], xyz: [...] } } to use presets.`
- `INTROSPECT_PRESET="xyz" is set but no introspect config was found.`

## Testing strategy

**Unit (vitest, in `@introspection/config`):**
- `resolve.test.ts` — exhaustive precedence cases, error messages match regex (10 tests, ported from current `config.spec.ts`).
- `load.test.ts` — discovery walk-up, same-dir, explicit `configPath` (valid + ENOENT), `cwd` with no ancestor config (5 tests, ported from current `config-loader.spec.ts`).
- `plugins.test.ts` — two to three integration tests of the sugar: default behavior, env-selected preset, explicit override.

**Consumer smoke:**
- `@introspection/playwright`'s existing test suite must still pass (no regressions from removing `config.ts`).
- `@introspection/cli`'s existing tests must still pass with the new loader.

**No new Playwright-browser tests.** The previous `attach-config.spec.ts` depended on launching chromium just to verify the config→plugins pipeline. That's now a pure-function concern in `plugins.test.ts`.

## Migration sequence

What was committed in the earlier (aborted) plan stays useful — it's mostly a relocation:

1. **Task 1 (kept as-is):** types in `@introspection/types` already shipped (SHA `7101619`).
2. **Scaffold `@introspection/config`** with `package.json`, tsup, tsconfig, vitest.
3. **Port `resolvePlugins`** into `src/resolve.ts` + `test/resolve.test.ts`.
4. **Port `loadIntrospectConfig`** into `src/load.ts` + `test/load.test.ts` + `test/fixtures/`.
5. **Add `loadPlugins`** sugar + `test/plugins.test.ts`.
6. **Revert `attach()`** to pre-Task-4 shape (drop `cwd`, drop config loading).
7. **Delete** the now-redundant files from `packages/playwright/` (`src/config.ts`, spec files, fixtures).
8. **Wire `@introspection/playwright`** to depend on and re-export from `@introspection/config`.
9. **Wire `@introspection/cli`** to use `loadIntrospectConfig` in `commands/debug.ts`.
10. **Docs:** README section in `@introspection/config` (primary) + short pointer in `@introspection/playwright`'s README.

The earlier Tasks 2–4 commits can either be reverted and redone cleanly in the new package, or kept in history (the code is small enough that reverting is clean). Let the plan decide.

## Out of scope

- Extending `introspectFixture` to auto-call `loadPlugins()` — that belongs to the follow-up integration-tests migration spec.
- Step-wrapping / screenshot plugin.
- Viewer migration in `services/integration-tests-viewer`.
- A CLI flag for presets (env var covers it).
- Any `c12`/`jiti` dependency — native `import()` continues to suffice.

## Self-review notes

- Placeholder scan: none.
- Internal consistency: error messages match between spec and prior test expectations; type names consistent throughout.
- Scope: single implementable unit (one new package + two small consumer changes). Within plan budget.
- Ambiguity: "keep CLI's optional-config fallback semantics" is explicit (falls back only when `--config` not set); array-form + env error is explicit.
