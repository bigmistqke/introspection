# Config-driven plugin presets for `@introspection/playwright`

> **Status:** landed (2026-04-23) · standalone plan (no separate spec)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let consumers of `@introspection/playwright` (fixture + `attach()`) declare plugin sets in an `introspect.config.{ts,js,mjs,mts}` file and select one per run via an environment variable, with zero plugins as the default.

**Architecture:** A new `config.ts` module in `@introspection/playwright` loads the nearest config file by walking up from `cwd` (native `import()`, Node 24+, matching the pattern already used by `@introspection/cli`). Config's `plugins` field accepts either an array (single always-active set) or an object of named presets where `default` is required. `attach()` resolves plugins with precedence: explicit `opts.plugins` → `INTROSPECT_PRESET` env var → `plugins.default` from config → `[]`. Array form in config with `INTROSPECT_PRESET` set is a hard error; unknown preset names are a hard error.

**Tech Stack:** TypeScript, Node 24+ native TS `import()`, Playwright Test (`.spec.ts`) for existing tests in this package.

---

## File Structure

**Create:**
- `packages/playwright/src/config.ts` — `loadIntrospectConfig()` (file discovery + import) and `resolvePlugins()` (pure precedence logic).
- `packages/playwright/test/config.spec.ts` — pure resolver tests.
- `packages/playwright/test/fixtures/config-array/introspect.config.ts` — array-form fixture.
- `packages/playwright/test/fixtures/config-presets/introspect.config.ts` — object-form fixture.
- `packages/playwright/test/config-loader.spec.ts` — loader (file discovery) tests.

**Modify:**
- `packages/types/src/index.ts` — add `PluginSet` and `IntrospectConfig` types.
- `packages/playwright/src/attach.ts` — call config loader + resolver when `opts.plugins` is not provided.
- `packages/playwright/src/index.ts` — re-export new types.

---

## Task 1: Add `PluginSet` and `IntrospectConfig` types

**Files:**
- Modify: `packages/types/src/index.ts` (append near `IntrospectionPlugin` at line 485)

- [ ] **Step 1: Add types**

Append after the `IntrospectionPlugin` interface in `packages/types/src/index.ts`:

```ts
/**
 * A plugins field in introspect config: either a flat array (single always-active set)
 * or an object of named presets where `default` is required.
 */
export type PluginSet =
  | IntrospectionPlugin[]
  | ({ default: IntrospectionPlugin[] } & Record<string, IntrospectionPlugin[]>)

/**
 * Shape of `introspect.config.{ts,js,mjs,mts}` default export.
 */
export interface IntrospectConfig {
  plugins?: PluginSet
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @introspection/types typecheck` (or the repo root `pnpm -r typecheck`)
Expected: PASS with no new errors.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "types: add PluginSet and IntrospectConfig"
```

---

## Task 2: Pure `resolvePlugins()` function with TDD

**Files:**
- Create: `packages/playwright/src/config.ts`
- Create: `packages/playwright/test/config.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/playwright/test/config.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { resolvePlugins } from '../src/config.js'
import type { IntrospectionPlugin } from '@introspection/types'

function fakePlugin(name: string): IntrospectionPlugin {
  return { name, install: async () => {} } as IntrospectionPlugin
}

test('returns [] when config is undefined and no env var', () => {
  expect(resolvePlugins({ config: undefined, env: {} })).toEqual([])
})

test('returns opts.plugins when provided, ignoring config and env', () => {
  const p = [fakePlugin('a')]
  const result = resolvePlugins({
    optsPlugins: p,
    config: { plugins: [fakePlugin('b')] },
    env: { INTROSPECT_PRESET: 'whatever' },
  })
  expect(result).toBe(p)
})

test('array-form config returns the array when env var not set', () => {
  const p = [fakePlugin('a')]
  expect(resolvePlugins({ config: { plugins: p }, env: {} })).toEqual(p)
})

test('array-form config with INTROSPECT_PRESET set throws', () => {
  expect(() =>
    resolvePlugins({
      config: { plugins: [fakePlugin('a')] },
      env: { INTROSPECT_PRESET: 'network' },
    })
  ).toThrow(/array form.*presets are not defined/i)
})

test('object-form config returns default preset when env var not set', () => {
  const dflt = [fakePlugin('d')]
  expect(
    resolvePlugins({
      config: { plugins: { default: dflt, network: [fakePlugin('n')] } },
      env: {},
    })
  ).toEqual(dflt)
})

test('object-form config returns named preset when env var set', () => {
  const net = [fakePlugin('n')]
  expect(
    resolvePlugins({
      config: { plugins: { default: [], network: net } },
      env: { INTROSPECT_PRESET: 'network' },
    })
  ).toEqual(net)
})

test('comma-separated env var merges presets in order', () => {
  const net = [fakePlugin('n')]
  const state = [fakePlugin('s')]
  expect(
    resolvePlugins({
      config: { plugins: { default: [], network: net, state } },
      env: { INTROSPECT_PRESET: 'network,state' },
    })
  ).toEqual([...net, ...state])
})

test('unknown preset name throws with a helpful message', () => {
  expect(() =>
    resolvePlugins({
      config: { plugins: { default: [], network: [] } },
      env: { INTROSPECT_PRESET: 'netwrk' },
    })
  ).toThrow(/unknown preset.*netwrk.*available.*default.*network/i)
})

test('env var with one unknown name in a list throws', () => {
  expect(() =>
    resolvePlugins({
      config: { plugins: { default: [], network: [] } },
      env: { INTROSPECT_PRESET: 'network,bogus' },
    })
  ).toThrow(/unknown preset.*bogus/i)
})

test('empty string env var is treated as unset', () => {
  expect(
    resolvePlugins({
      config: { plugins: { default: [fakePlugin('d')] } },
      env: { INTROSPECT_PRESET: '' },
    })
  ).toEqual([fakePlugin('d')].map(p => expect.objectContaining({ name: p.name })))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @introspection/playwright test --grep "resolvePlugins"` (or `npx playwright test test/config.spec.ts`)
Expected: FAIL — `Cannot find module '../src/config.js'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/playwright/src/config.ts`:

```ts
import type { IntrospectionPlugin, IntrospectConfig, PluginSet } from '@introspection/types'

export interface ResolvePluginsArgs {
  optsPlugins?: IntrospectionPlugin[]
  config?: IntrospectConfig
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
}

function isArrayForm(plugins: PluginSet): plugins is IntrospectionPlugin[] {
  return Array.isArray(plugins)
}

export function resolvePlugins(args: ResolvePluginsArgs): IntrospectionPlugin[] {
  if (args.optsPlugins) return args.optsPlugins

  const preset = args.env.INTROSPECT_PRESET?.trim() || undefined
  const plugins = args.config?.plugins

  if (!plugins) {
    if (preset) {
      throw new Error(
        `INTROSPECT_PRESET="${preset}" is set but no introspect config was found.`
      )
    }
    return []
  }

  if (isArrayForm(plugins)) {
    if (preset) {
      throw new Error(
        `INTROSPECT_PRESET="${preset}" is set, but introspect config uses array form — presets are not defined. ` +
        `Change config to { plugins: { default: [...], ${preset}: [...] } } to use presets.`
      )
    }
    return plugins
  }

  const names = preset ? preset.split(',').map(s => s.trim()).filter(Boolean) : ['default']
  const available = Object.keys(plugins)
  const out: IntrospectionPlugin[] = []
  for (const name of names) {
    const set = plugins[name]
    if (!set) {
      throw new Error(
        `Unknown preset "${name}". Available presets: ${available.join(', ')}.`
      )
    }
    out.push(...set)
  }
  return out
}
```

- [ ] **Step 4: Fix the last test's assertion**

The "empty string env var" test uses `expect.objectContaining` incorrectly in a plain `toEqual`. Replace that test body with a clean assertion:

```ts
test('empty string env var is treated as unset', () => {
  const dflt = [fakePlugin('d')]
  expect(
    resolvePlugins({
      config: { plugins: { default: dflt } },
      env: { INTROSPECT_PRESET: '' },
    })
  ).toEqual(dflt)
})
```

- [ ] **Step 5: Run tests, verify all pass**

Run: `pnpm -F @introspection/playwright test --grep "resolvePlugins"`
Expected: PASS (all 10 tests green).

- [ ] **Step 6: Commit**

```bash
git add packages/playwright/src/config.ts packages/playwright/test/config.spec.ts
git commit -m "playwright: add pure resolvePlugins() with precedence rules"
```

---

## Task 3: Config file loader (walks up from cwd)

**Files:**
- Modify: `packages/playwright/src/config.ts`
- Create: `packages/playwright/test/fixtures/config-array/introspect.config.ts`
- Create: `packages/playwright/test/fixtures/config-presets/introspect.config.ts`
- Create: `packages/playwright/test/fixtures/config-presets/nested/dir/marker.txt` (just to prove walk-up works)
- Create: `packages/playwright/test/config-loader.spec.ts`

- [ ] **Step 1: Create fixture configs**

Create `packages/playwright/test/fixtures/config-array/introspect.config.ts`:

```ts
import type { IntrospectConfig } from '@introspection/types'

const config: IntrospectConfig = {
  plugins: [{ name: 'fixture-array-plugin', install: async () => {} }],
}
export default config
```

Create `packages/playwright/test/fixtures/config-presets/introspect.config.ts`:

```ts
import type { IntrospectConfig } from '@introspection/types'

const config: IntrospectConfig = {
  plugins: {
    default: [{ name: 'fixture-default-plugin', install: async () => {} }],
    network: [{ name: 'fixture-network-plugin', install: async () => {} }],
  },
}
export default config
```

Create the nested dir marker to have a subdirectory to walk up from:

```bash
mkdir -p packages/playwright/test/fixtures/config-presets/nested/dir
touch packages/playwright/test/fixtures/config-presets/nested/dir/marker.txt
```

- [ ] **Step 2: Write the failing loader tests**

Create `packages/playwright/test/config-loader.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { loadIntrospectConfig } from '../src/config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('returns undefined when no config is found above cwd', async () => {
  // /tmp has no ancestor with introspect.config.*
  const result = await loadIntrospectConfig({ cwd: '/tmp' })
  expect(result).toBeUndefined()
})

test('loads array-form config from same directory', async () => {
  const cwd = resolve(__dirname, 'fixtures/config-array')
  const config = await loadIntrospectConfig({ cwd })
  expect(config).toBeDefined()
  expect(Array.isArray(config!.plugins)).toBe(true)
})

test('loads preset-form config from a nested subdirectory (walks up)', async () => {
  const cwd = resolve(__dirname, 'fixtures/config-presets/nested/dir')
  const config = await loadIntrospectConfig({ cwd })
  expect(config).toBeDefined()
  expect(Array.isArray(config!.plugins)).toBe(false)
  const presets = config!.plugins as Record<string, unknown>
  expect(Object.keys(presets).sort()).toEqual(['default', 'network'])
})

test('respects explicit configPath, skipping discovery', async () => {
  const explicit = resolve(__dirname, 'fixtures/config-presets/introspect.config.ts')
  const config = await loadIntrospectConfig({ cwd: '/tmp', configPath: explicit })
  expect(config).toBeDefined()
  expect(Array.isArray(config!.plugins)).toBe(false)
})

test('throws when explicit configPath does not exist', async () => {
  await expect(
    loadIntrospectConfig({ cwd: '/tmp', configPath: '/no/such/file.ts' })
  ).rejects.toThrow(/no such file|ENOENT|not found/i)
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm -F @introspection/playwright test --grep "config-loader|loadIntrospectConfig"`
Expected: FAIL — `loadIntrospectConfig` is not exported.

- [ ] **Step 4: Implement the loader**

Append to `packages/playwright/src/config.ts`:

```ts
import { access, stat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const CONFIG_FILENAMES = [
  'introspect.config.ts',
  'introspect.config.mts',
  'introspect.config.js',
  'introspect.config.mjs',
]

export interface LoadConfigOptions {
  cwd?: string
  configPath?: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function findConfigFile(startDir: string): Promise<string | undefined> {
  let dir = resolve(startDir)
  // Walk up until filesystem root.
  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = resolve(dir, name)
      if (await exists(candidate)) return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

export async function loadIntrospectConfig(
  opts: LoadConfigOptions = {}
): Promise<IntrospectConfig | undefined> {
  let path: string | undefined
  if (opts.configPath) {
    // Let fs surface ENOENT explicitly for a better error than a bare import failure.
    await stat(opts.configPath)
    path = opts.configPath
  } else {
    path = await findConfigFile(opts.cwd ?? process.cwd())
    if (!path) return undefined
  }
  const mod = await import(pathToFileURL(path).href)
  const config = (mod.default ?? mod) as IntrospectConfig
  return config
}
```

- [ ] **Step 5: Run tests, verify all pass**

Run: `pnpm -F @introspection/playwright test --grep "config-loader|loadIntrospectConfig"`
Expected: PASS (all 5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/playwright/src/config.ts packages/playwright/test/config-loader.spec.ts packages/playwright/test/fixtures
git commit -m "playwright: add loadIntrospectConfig() with upward directory search"
```

---

## Task 4: Wire resolver + loader into `attach()`

**Files:**
- Modify: `packages/playwright/src/attach.ts`
- Modify: `packages/playwright/src/index.ts`
- Modify: `packages/playwright/test/fixture.spec.ts` (extend existing) or create `packages/playwright/test/attach-config.spec.ts`

- [ ] **Step 1: Write the integration test**

Create `packages/playwright/test/attach-config.spec.ts`:

```ts
import { test, expect, chromium } from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { attach } from '../src/attach.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function readEvents(traceRoot: string): Array<Record<string, unknown>> {
  const entries = readdirSync(traceRoot).filter(entry => !entry.startsWith('.'))
  const traceDir = join(traceRoot, entries[0])
  const ndjson = readFileSync(join(traceDir, 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

function readMeta(traceRoot: string): Record<string, unknown> {
  const entries = readdirSync(traceRoot).filter(entry => !entry.startsWith('.'))
  const traceDir = join(traceRoot, entries[0])
  return JSON.parse(readFileSync(join(traceDir, 'meta.json'), 'utf-8'))
}

test('attach loads config from cwd and uses default preset when env unset', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'introspect-attach-cfg-'))
  const cwd = resolve(__dirname, 'fixtures/config-presets')
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    const handle = await attach(page, { outDir, cwd })
    await handle.detach({ status: 'passed' })
    const meta = readMeta(outDir)
    const names = ((meta.plugins as Array<{ name: string }>) ?? []).map(p => p.name)
    expect(names).toEqual(['fixture-default-plugin'])
  } finally {
    await browser.close()
    rmSync(outDir, { recursive: true, force: true })
  }
})

test('attach selects preset via INTROSPECT_PRESET env var', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'introspect-attach-cfg-'))
  const cwd = resolve(__dirname, 'fixtures/config-presets')
  const prev = process.env.INTROSPECT_PRESET
  process.env.INTROSPECT_PRESET = 'network'
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    const handle = await attach(page, { outDir, cwd })
    await handle.detach({ status: 'passed' })
    const meta = readMeta(outDir)
    const names = ((meta.plugins as Array<{ name: string }>) ?? []).map(p => p.name)
    expect(names).toEqual(['fixture-network-plugin'])
  } finally {
    if (prev === undefined) delete process.env.INTROSPECT_PRESET
    else process.env.INTROSPECT_PRESET = prev
    await browser.close()
    rmSync(outDir, { recursive: true, force: true })
  }
})

test('explicit opts.plugins overrides config entirely', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'introspect-attach-cfg-'))
  const cwd = resolve(__dirname, 'fixtures/config-presets')
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    const handle = await attach(page, {
      outDir,
      cwd,
      plugins: [{ name: 'explicit-override', install: async () => {} } as any],
    })
    await handle.detach({ status: 'passed' })
    const meta = readMeta(outDir)
    const names = ((meta.plugins as Array<{ name: string }>) ?? []).map(p => p.name)
    expect(names).toEqual(['explicit-override'])
  } finally {
    await browser.close()
    rmSync(outDir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @introspection/playwright test --grep "attach loads config"`
Expected: FAIL — `attach` does not accept `cwd` option / does not call config loader.

- [ ] **Step 3: Modify `attach()` to load config + resolve plugins**

Edit `packages/playwright/src/attach.ts`:

1. Add `cwd?: string` to `AttachOptions`:

```ts
export interface AttachOptions {
  outDir?: string
  id?: string
  testTitle?: string
  titlePath?: string[]
  workerIndex?: number
  plugins?: IntrospectionPlugin[]
  verbose?: boolean
  trace?: TraceWriter
  cwd?: string
}
```

2. Add the import at the top of the file:

```ts
import { loadIntrospectConfig, resolvePlugins } from './config.js'
```

3. Replace the line:

```ts
const plugins = options.plugins ?? []
```

with:

```ts
const config = options.plugins
  ? undefined
  : await loadIntrospectConfig({ cwd: options.cwd })
const plugins = resolvePlugins({
  optsPlugins: options.plugins,
  config,
  env: process.env,
})
```

- [ ] **Step 4: Run integration tests, verify pass**

Run: `pnpm -F @introspection/playwright test --grep "attach loads config|attach selects preset|explicit opts.plugins"`
Expected: PASS (3 tests).

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `pnpm -F @introspection/playwright test`
Expected: PASS (all existing tests + new ones).

- [ ] **Step 6: Export new types from the package entrypoint**

Edit `packages/playwright/src/index.ts` to add:

```ts
export { loadIntrospectConfig, resolvePlugins } from './config.js'
export type { LoadConfigOptions, ResolvePluginsArgs } from './config.js'
export type { IntrospectConfig, PluginSet } from '@introspection/types'
```

- [ ] **Step 7: Typecheck and build**

Run: `pnpm -F @introspection/playwright typecheck && pnpm -F @introspection/playwright build`
Expected: PASS with no new errors.

- [ ] **Step 8: Commit**

```bash
git add packages/playwright/src/attach.ts packages/playwright/src/index.ts packages/playwright/test/attach-config.spec.ts
git commit -m "playwright: resolve plugins from introspect.config + INTROSPECT_PRESET"
```

---

## Task 5: Update README with the new workflow

**Files:**
- Modify: `packages/playwright/README.md`

- [ ] **Step 1: Add a "Config-driven plugins" section**

Add the following section to `packages/playwright/README.md` (just before the existing plugin/usage examples, or in a new top-level section — match the existing README's style):

````markdown
## Config-driven plugins

`attach()` and `introspectFixture()` load `introspect.config.{ts,js,mjs,mts}` from the nearest ancestor directory at startup. The config's `plugins` field can be either a flat array (always active) or a named-preset object (select via env var).

**Array form — always-active plugin set:**

```ts
// introspect.config.ts
import { network } from '@introspection/plugin-network'
import type { IntrospectConfig } from '@introspection/types'

export default {
  plugins: [network()],
} satisfies IntrospectConfig
```

**Preset form — `default` required, select others via `INTROSPECT_PRESET`:**

```ts
// introspect.config.ts
import { network } from '@introspection/plugin-network'
import { jsError } from '@introspection/plugin-js-error'
import { redux } from '@introspection/plugin-redux'
import type { IntrospectConfig } from '@introspection/types'

export default {
  plugins: {
    default: [],
    network: [network(), jsError()],
    state:   [redux({ captureState: true }), jsError()],
  },
} satisfies IntrospectConfig
```

- Run tests normally → no plugins attached (`default` is `[]`).
- `INTROSPECT_PRESET=network` → `network` preset.
- `INTROSPECT_PRESET=network,state` → merged.
- `INTROSPECT_PRESET=typo` → hard error listing available presets.

**Precedence (high → low):**

1. `attach(page, { plugins: [...] })` — explicit override, skips config and env entirely.
2. `INTROSPECT_PRESET` env var — looked up in the preset object.
3. `plugins.default` from config.
4. `[]`.

Setting `INTROSPECT_PRESET` while the config uses array form is a hard error — array form has no named presets to select.
````

- [ ] **Step 2: Commit**

```bash
git add packages/playwright/README.md
git commit -m "playwright: document introspect.config preset workflow"
```

---

## Self-Review Notes

- All four tasks produce independently testable artifacts (types → pure function → loader → integration).
- No placeholders; every step shows the exact code or command.
- Type names (`PluginSet`, `IntrospectConfig`, `ResolvePluginsArgs`, `LoadConfigOptions`) are consistent across tasks.
- Spec coverage: config shape ✓, preset resolution ✓, env var comma-merge ✓, unknown preset error ✓, array+env error ✓, `opts.plugins` override ✓, upward file discovery ✓, explicit `configPath` ✓, no-deps loader (native `import()`) ✓.
- Out of scope (deferred): the `introspectFixture` changes to pass `cwd` through or extend with step-wrapping/screenshots; those belong to the separate `services/integration-tests` migration.
