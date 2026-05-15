# `@introspection/config` package implementation plan

> **Status:** landed (2026-04-23) · spec: `docs/superpowers/specs/2026-04-23-introspection-config-package-design.md`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract config loading + plugin preset resolution into a new `@introspection/config` package, revert `attach()` to a pure primitive, and migrate both `@introspection/playwright` and `@introspection/cli` to consume it.

**Architecture:** Three-layer split: types in `@introspection/types` (already shipped), loader/resolver in new `@introspection/config`, consumers in `@introspection/playwright` and `@introspection/cli`. Native Node 24+ `import()` for `.ts` config files (no jiti). vitest for pure-function tests.

**Tech Stack:** TypeScript, pnpm workspace, tsup (build), vitest (tests), Node 24+ native TS import().

---

## Starting state

- Task 1 (types) is already committed as `7101619`: `PluginSet` and `IntrospectConfig` live in `packages/types/src/index.ts`.
- Earlier iterations added `packages/playwright/src/config.ts`, tests, and fixtures inside the playwright package (commits `3c072b5`, `8fdb789`, `13192d6`). This plan **moves that code to a new package** and reverts the `attach()` changes. The earlier commits stay in git history — we don't revert them; we make forward changes that supersede them.
- Two pre-existing unrelated uncommitted files exist on `main` (`.claude/settings.local.json`, `demos/static-report/test-report.html`). Do NOT stage them at any point.

## File structure

**Create (new package):**

```
packages/config/
  package.json
  tsconfig.json
  tsup.config.ts
  vitest.config.ts
  src/
    index.ts          — public exports
    resolve.ts        — resolvePlugins (pure)
    load.ts           — loadIntrospectConfig (filesystem)
    plugins.ts        — loadPlugins (sugar combining load + resolve)
  test/
    resolve.test.ts
    load.test.ts
    plugins.test.ts
    fixtures/
      config-array/introspect.config.ts
      config-presets/introspect.config.ts
      config-presets/nested/dir/marker.txt
  README.md
```

**Modify:**
- `packages/playwright/src/attach.ts` — drop `cwd`, drop config loading, restore `plugins ?? []`.
- `packages/playwright/src/index.ts` — re-export from `@introspection/config`.
- `packages/playwright/package.json` — add `@introspection/config` dep.
- `packages/cli/src/commands/debug.ts` — replace ad-hoc config loading with `loadIntrospectConfig`.
- `packages/cli/package.json` — add `@introspection/config` dep.

**Delete:**
- `packages/playwright/src/config.ts`
- `packages/playwright/test/config.spec.ts`
- `packages/playwright/test/config-loader.spec.ts`
- `packages/playwright/test/attach-config.spec.ts`
- `packages/playwright/test/fixtures/` (entire directory)

---

## Task 1: Scaffold `@introspection/config` package

**Files:**
- Create: `packages/config/package.json`
- Create: `packages/config/tsconfig.json`
- Create: `packages/config/tsup.config.ts`
- Create: `packages/config/vitest.config.ts`
- Create: `packages/config/src/index.ts` (empty placeholder)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@introspection/config",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@introspection/types": "workspace:*"
  },
  "devDependencies": {
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `tsup.config.ts`**

```ts
import { defineConfig } from 'tsup'
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
})
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { globals: true }
})
```

- [ ] **Step 5: Create empty `src/index.ts`**

```ts
export {}
```

- [ ] **Step 6: Install and verify workspace picks up the new package**

Run from repo root: `pnpm install`
Expected: exits cleanly; new package appears in `pnpm ls --filter '@introspection/*'`.

Run: `pnpm -F @introspection/config typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```
git add packages/config/package.json packages/config/tsconfig.json packages/config/tsup.config.ts packages/config/vitest.config.ts packages/config/src/index.ts pnpm-lock.yaml
git commit -m "config: scaffold @introspection/config package"
```

Stage only those files. If `pnpm install` modified other files unexpectedly, investigate before committing.

---

## Task 2: Port `resolvePlugins` (pure resolver) with TDD

**Files:**
- Create: `packages/config/src/resolve.ts`
- Create: `packages/config/test/resolve.test.ts`
- Modify: `packages/config/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/config/test/resolve.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolvePlugins } from '../src/resolve.js'
import type { IntrospectionPlugin } from '@introspection/types'

function fakePlugin(name: string): IntrospectionPlugin {
  return { name, install: async () => {} } as IntrospectionPlugin
}

describe('resolvePlugins', () => {
  it('returns [] when config is undefined and no env var', () => {
    expect(resolvePlugins({ config: undefined, env: {} })).toEqual([])
  })

  it('returns opts.plugins when provided, ignoring config and env', () => {
    const p = [fakePlugin('a')]
    const result = resolvePlugins({
      optsPlugins: p,
      config: { plugins: [fakePlugin('b')] },
      env: { INTROSPECT_PRESET: 'whatever' },
    })
    expect(result).toBe(p)
  })

  it('array-form config returns the array when env var not set', () => {
    const p = [fakePlugin('a')]
    expect(resolvePlugins({ config: { plugins: p }, env: {} })).toEqual(p)
  })

  it('array-form config with INTROSPECT_PRESET set throws', () => {
    expect(() =>
      resolvePlugins({
        config: { plugins: [fakePlugin('a')] },
        env: { INTROSPECT_PRESET: 'network' },
      })
    ).toThrow(/array form.*presets are not defined/i)
  })

  it('object-form config returns default preset when env var not set', () => {
    const dflt = [fakePlugin('d')]
    expect(
      resolvePlugins({
        config: { plugins: { default: dflt, network: [fakePlugin('n')] } },
        env: {},
      })
    ).toEqual(dflt)
  })

  it('object-form config returns named preset when env var set', () => {
    const net = [fakePlugin('n')]
    expect(
      resolvePlugins({
        config: { plugins: { default: [], network: net } },
        env: { INTROSPECT_PRESET: 'network' },
      })
    ).toEqual(net)
  })

  it('comma-separated env var merges presets in order', () => {
    const net = [fakePlugin('n')]
    const state = [fakePlugin('s')]
    expect(
      resolvePlugins({
        config: { plugins: { default: [], network: net, state } },
        env: { INTROSPECT_PRESET: 'network,state' },
      })
    ).toEqual([...net, ...state])
  })

  it('unknown preset name throws with a helpful message', () => {
    expect(() =>
      resolvePlugins({
        config: { plugins: { default: [], network: [] } },
        env: { INTROSPECT_PRESET: 'netwrk' },
      })
    ).toThrow(/unknown preset.*netwrk.*available.*default.*network/i)
  })

  it('env var with one unknown name in a list throws', () => {
    expect(() =>
      resolvePlugins({
        config: { plugins: { default: [], network: [] } },
        env: { INTROSPECT_PRESET: 'network,bogus' },
      })
    ).toThrow(/unknown preset.*bogus/i)
  })

  it('empty string env var is treated as unset', () => {
    const dflt = [fakePlugin('d')]
    expect(
      resolvePlugins({
        config: { plugins: { default: dflt } },
        env: { INTROSPECT_PRESET: '' },
      })
    ).toEqual(dflt)
  })

  it('INTROSPECT_PRESET set with no config throws', () => {
    expect(() =>
      resolvePlugins({
        config: undefined,
        env: { INTROSPECT_PRESET: 'network' },
      })
    ).toThrow(/INTROSPECT_PRESET.*no introspect config was found/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @introspection/config test`
Expected: FAIL — `Cannot find module '../src/resolve.js'`.

- [ ] **Step 3: Implement `resolvePlugins`**

Create `packages/config/src/resolve.ts`:

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

- [ ] **Step 4: Export from `src/index.ts`**

Replace the contents of `packages/config/src/index.ts` with:

```ts
export { resolvePlugins } from './resolve.js'
export type { ResolvePluginsArgs } from './resolve.js'
export type { IntrospectConfig, PluginSet } from '@introspection/types'
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `pnpm -F @introspection/config test`
Expected: 11/11 tests PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm -F @introspection/config typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```
git add packages/config/src/resolve.ts packages/config/src/index.ts packages/config/test/resolve.test.ts
git commit -m "config: add resolvePlugins() with precedence rules"
```

---

## Task 3: Port `loadIntrospectConfig` (file discovery + import) with TDD

**Files:**
- Create: `packages/config/src/load.ts`
- Create: `packages/config/test/load.test.ts`
- Create: `packages/config/test/fixtures/config-array/introspect.config.ts`
- Create: `packages/config/test/fixtures/config-presets/introspect.config.ts`
- Create: `packages/config/test/fixtures/config-presets/nested/dir/marker.txt`
- Modify: `packages/config/src/index.ts`

- [ ] **Step 1: Create fixture configs and nested marker**

Create `packages/config/test/fixtures/config-array/introspect.config.ts`:

```ts
import type { IntrospectConfig } from '@introspection/types'

const config: IntrospectConfig = {
  plugins: [{ name: 'fixture-array-plugin', install: async () => {} }],
}
export default config
```

Create `packages/config/test/fixtures/config-presets/introspect.config.ts`:

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

Create the nested dir + marker:
```
mkdir -p packages/config/test/fixtures/config-presets/nested/dir
touch packages/config/test/fixtures/config-presets/nested/dir/marker.txt
```

- [ ] **Step 2: Write the failing loader tests**

Create `packages/config/test/load.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { loadIntrospectConfig } from '../src/load.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('loadIntrospectConfig', () => {
  it('returns undefined when no config is found above cwd', async () => {
    const result = await loadIntrospectConfig({ cwd: '/tmp' })
    expect(result).toBeUndefined()
  })

  it('loads array-form config from same directory', async () => {
    const cwd = resolve(__dirname, 'fixtures/config-array')
    const config = await loadIntrospectConfig({ cwd })
    expect(config).toBeDefined()
    expect(Array.isArray(config!.plugins)).toBe(true)
  })

  it('loads preset-form config from a nested subdirectory (walks up)', async () => {
    const cwd = resolve(__dirname, 'fixtures/config-presets/nested/dir')
    const config = await loadIntrospectConfig({ cwd })
    expect(config).toBeDefined()
    expect(Array.isArray(config!.plugins)).toBe(false)
    const presets = config!.plugins as Record<string, unknown>
    expect(Object.keys(presets).sort()).toEqual(['default', 'network'])
  })

  it('respects explicit configPath, skipping discovery', async () => {
    const explicit = resolve(__dirname, 'fixtures/config-presets/introspect.config.ts')
    const config = await loadIntrospectConfig({ cwd: '/tmp', configPath: explicit })
    expect(config).toBeDefined()
    expect(Array.isArray(config!.plugins)).toBe(false)
  })

  it('throws when explicit configPath does not exist', async () => {
    await expect(
      loadIntrospectConfig({ cwd: '/tmp', configPath: '/no/such/file.ts' })
    ).rejects.toThrow(/no such file|ENOENT|not found/i)
  })

  it('defaults cwd to process.cwd() when not provided', async () => {
    const prev = process.cwd()
    const fixtureCwd = resolve(__dirname, 'fixtures/config-array')
    try {
      process.chdir(fixtureCwd)
      const config = await loadIntrospectConfig()
      expect(config).toBeDefined()
      expect(Array.isArray(config!.plugins)).toBe(true)
    } finally {
      process.chdir(prev)
    }
  })
})
```

- [ ] **Step 3: Run to verify tests fail**

Run: `pnpm -F @introspection/config test`
Expected: resolve tests PASS (11), load tests FAIL — `Cannot find module '../src/load.js'`.

- [ ] **Step 4: Implement the loader**

Create `packages/config/src/load.ts`:

```ts
import { access, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { IntrospectConfig } from '@introspection/types'

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

- [ ] **Step 5: Add loader exports to `src/index.ts`**

Replace `packages/config/src/index.ts` with:

```ts
export { resolvePlugins } from './resolve.js'
export type { ResolvePluginsArgs } from './resolve.js'
export { loadIntrospectConfig } from './load.js'
export type { LoadConfigOptions } from './load.js'
export type { IntrospectConfig, PluginSet } from '@introspection/types'
```

- [ ] **Step 6: Run tests, verify all pass**

Run: `pnpm -F @introspection/config test`
Expected: 17/17 tests PASS (11 resolve + 6 load).

- [ ] **Step 7: Typecheck**

Run: `pnpm -F @introspection/config typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```
git add packages/config/src/load.ts packages/config/src/index.ts packages/config/test/load.test.ts packages/config/test/fixtures
git commit -m "config: add loadIntrospectConfig() with upward directory search"
```

---

## Task 4: Add `loadPlugins` sugar (load + resolve in one call) with TDD

**Files:**
- Create: `packages/config/src/plugins.ts`
- Create: `packages/config/test/plugins.test.ts`
- Modify: `packages/config/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/config/test/plugins.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { loadPlugins } from '../src/plugins.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('loadPlugins', () => {
  const presetsCwd = resolve(__dirname, 'fixtures/config-presets')

  it('returns default preset when env var not set', async () => {
    const plugins = await loadPlugins({ cwd: presetsCwd, env: {} })
    expect(plugins.map(p => p.name)).toEqual(['fixture-default-plugin'])
  })

  it('returns named preset when INTROSPECT_PRESET is set', async () => {
    const plugins = await loadPlugins({
      cwd: presetsCwd,
      env: { INTROSPECT_PRESET: 'network' },
    })
    expect(plugins.map(p => p.name)).toEqual(['fixture-network-plugin'])
  })

  it('returns optsPlugins verbatim when provided, skipping config', async () => {
    const fake = [{ name: 'explicit', install: async () => {} }] as any
    const plugins = await loadPlugins({
      cwd: presetsCwd,
      env: { INTROSPECT_PRESET: 'network' },
      optsPlugins: fake,
    })
    expect(plugins).toBe(fake)
  })

  it('returns [] when no config is discovered and no opts', async () => {
    const plugins = await loadPlugins({ cwd: '/tmp', env: {} })
    expect(plugins).toEqual([])
  })

  it('defaults env to process.env when not provided', async () => {
    const prev = process.env.INTROSPECT_PRESET
    process.env.INTROSPECT_PRESET = 'network'
    try {
      const plugins = await loadPlugins({ cwd: presetsCwd })
      expect(plugins.map(p => p.name)).toEqual(['fixture-network-plugin'])
    } finally {
      if (prev === undefined) delete process.env.INTROSPECT_PRESET
      else process.env.INTROSPECT_PRESET = prev
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @introspection/config test`
Expected: `plugins.test.ts` fails — `Cannot find module '../src/plugins.js'`.

- [ ] **Step 3: Implement `loadPlugins`**

Create `packages/config/src/plugins.ts`:

```ts
import type { IntrospectionPlugin } from '@introspection/types'
import { loadIntrospectConfig } from './load.js'
import { resolvePlugins } from './resolve.js'

export interface LoadPluginsOptions {
  cwd?: string
  configPath?: string
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  optsPlugins?: IntrospectionPlugin[]
}

export async function loadPlugins(
  opts: LoadPluginsOptions = {}
): Promise<IntrospectionPlugin[]> {
  const config = opts.optsPlugins
    ? undefined
    : await loadIntrospectConfig({ cwd: opts.cwd, configPath: opts.configPath })
  return resolvePlugins({
    optsPlugins: opts.optsPlugins,
    config,
    env: opts.env ?? process.env,
  })
}
```

- [ ] **Step 4: Add to `src/index.ts`**

Replace `packages/config/src/index.ts` with:

```ts
export { resolvePlugins } from './resolve.js'
export type { ResolvePluginsArgs } from './resolve.js'
export { loadIntrospectConfig } from './load.js'
export type { LoadConfigOptions } from './load.js'
export { loadPlugins } from './plugins.js'
export type { LoadPluginsOptions } from './plugins.js'
export type { IntrospectConfig, PluginSet } from '@introspection/types'
```

- [ ] **Step 5: Run tests, verify all pass**

Run: `pnpm -F @introspection/config test`
Expected: 22/22 tests PASS.

- [ ] **Step 6: Build and typecheck the package**

Run: `pnpm -F @introspection/config build && pnpm -F @introspection/config typecheck`
Expected: both PASS.

- [ ] **Step 7: Commit**

```
git add packages/config/src/plugins.ts packages/config/src/index.ts packages/config/test/plugins.test.ts
git commit -m "config: add loadPlugins() sugar combining load + resolve"
```

---

## Task 5: Revert `attach()` and remove old files from `@introspection/playwright`

**Files:**
- Modify: `packages/playwright/src/attach.ts`
- Delete: `packages/playwright/src/config.ts`
- Delete: `packages/playwright/test/config.spec.ts`
- Delete: `packages/playwright/test/config-loader.spec.ts`
- Delete: `packages/playwright/test/attach-config.spec.ts`
- Delete: `packages/playwright/test/fixtures/` (whole tree)

- [ ] **Step 1: Revert `attach()` to pre-config shape**

Edit `packages/playwright/src/attach.ts`:

Remove `cwd` from `AttachOptions`:

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
}
```

Remove the import line:

```ts
import { loadIntrospectConfig, resolvePlugins } from './config.js'
```

Replace this block in the `attach()` body:

```ts
const config = (options.plugins || !options.cwd)
  ? undefined
  : await loadIntrospectConfig({ cwd: options.cwd })
const plugins = resolvePlugins({
  optsPlugins: options.plugins,
  config,
  env: process.env,
})
```

with the original:

```ts
const plugins = options.plugins ?? []
```

- [ ] **Step 2: Delete the now-unused files**

```
rm packages/playwright/src/config.ts
rm packages/playwright/test/config.spec.ts
rm packages/playwright/test/config-loader.spec.ts
rm packages/playwright/test/attach-config.spec.ts
rm -rf packages/playwright/test/fixtures
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @introspection/playwright typecheck`
Expected: PASS.

- [ ] **Step 4: Run full playwright test suite**

Run: `pnpm -F @introspection/playwright test`
Expected: all remaining tests pass (the three ported spec files are gone; `attach.spec.ts`, `fixture.spec.ts`, `proxy.spec.ts` still pass).

- [ ] **Step 5: Commit**

```
git add -u packages/playwright
git commit -m "playwright: revert attach() config loading; moves to @introspection/config"
```

`git add -u packages/playwright` stages tracked file modifications and deletions under that path only — it will NOT pick up the pre-existing unrelated uncommitted files at repo root. Verify with `git status` before committing.

---

## Task 6: Wire `@introspection/playwright` to re-export from `@introspection/config`

**Files:**
- Modify: `packages/playwright/package.json`
- Modify: `packages/playwright/src/index.ts`

- [ ] **Step 1: Add dep**

Edit `packages/playwright/package.json`, add `"@introspection/config": "workspace:*"` to `dependencies`:

```json
{
  "dependencies": {
    "@introspection/config": "workspace:*",
    "@introspection/utils": "workspace:*",
    "@introspection/write": "workspace:*",
    "@introspection/types": "workspace:*"
  }
}
```

- [ ] **Step 2: Re-export from `src/index.ts`**

Edit `packages/playwright/src/index.ts`. It currently contains (verify by reading the file first):

```ts
export { attach } from './attach.js'
export type { AttachOptions } from './attach.js'
export { trace } from './trace.js'
export type { TraceOptions, TraceContext } from './trace.js'
export { createTraceWriter } from '@introspection/write'
export type { CreateTraceWriterOptions } from '@introspection/write'
export type { BusPayloadMap, BusTrigger, TraceWriter } from '@introspection/types'
```

Append:

```ts
export { loadPlugins, loadIntrospectConfig, resolvePlugins } from '@introspection/config'
export type { LoadPluginsOptions, LoadConfigOptions, ResolvePluginsArgs, IntrospectConfig, PluginSet } from '@introspection/config'
```

- [ ] **Step 3: Install + verify**

Run: `pnpm install`
Expected: adds the workspace link; lockfile updates.

Run: `pnpm -F @introspection/playwright typecheck && pnpm -F @introspection/playwright build && pnpm -F @introspection/playwright test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```
git add packages/playwright/package.json packages/playwright/src/index.ts pnpm-lock.yaml
git commit -m "playwright: depend on @introspection/config and re-export"
```

---

## Task 7: Wire `@introspection/cli` to use `loadIntrospectConfig`

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `packages/cli/src/commands/debug.ts`

**Current CLI loading (for reference):** `packages/cli/src/commands/debug.ts` lines ~34–74 do:

```ts
const configPath = resolvePath(process.cwd(), opts.config || './introspect.config.ts')
let config: { plugins: any[] } = { plugins: [] }
let configExists = false
try { await stat(configPath); configExists = true } catch { configExists = false }
if (configExists || opts.config) {
  try {
    const configModule = await import(configPath)
    config = configModule.default
    if (!config.plugins || !Array.isArray(config.plugins)) {
      if (opts.config) throw new Error('Config must export default object with plugins array')
      config = { plugins: [] }
    }
  } catch (err) {
    if (opts.config) { console.error(`Failed to load config from ${configPath}`); throw err }
    config = { plugins: [] }
  }
}
```

The CLI later uses `config.plugins` to pass into `attach()`. Semantics to preserve:
- `opts.config` explicitly passed → load that exact path; errors propagate.
- No `opts.config` → try `./introspect.config.ts` from `process.cwd()`; silently fall back to `{ plugins: [] }` on any error or missing file.

The new package's `loadIntrospectConfig({ configPath })` throws on missing explicit path, and `resolvePlugins` handles the array/preset logic. We'll keep the CLI's silent-fallback behavior for the discovery path.

- [ ] **Step 1: Add dep**

Edit `packages/cli/package.json`, add `"@introspection/config": "workspace:*"` to `dependencies`:

```json
"@introspection/config": "workspace:*",
```

- [ ] **Step 2: Replace the loading block in `debug.ts`**

At the top of `packages/cli/src/commands/debug.ts`, add the import alongside existing imports:

```ts
import { loadIntrospectConfig, resolvePlugins } from '@introspection/config'
```

Remove the now-unused imports (if present and no other use in the file): the `import { readFile, stat } from 'fs/promises'` line can lose `stat` (keep `readFile` — it's used elsewhere in the file for the playwright script). Check usages; keep what's still referenced.

Replace the block starting with `// Resolve config` through the closing of the `if (configExists || opts.config) { ... }` block (roughly lines 32–74 before edits — verify by reading) with:

```ts
debug('Resolving config...')

let plugins: IntrospectionPlugin[] = []
try {
  const config = opts.config
    ? await loadIntrospectConfig({ configPath: resolvePath(process.cwd(), opts.config) })
    : await loadIntrospectConfig({ cwd: process.cwd() })
  plugins = resolvePlugins({ config, env: process.env })
} catch (err) {
  if (opts.config) {
    console.error(`Failed to load config from ${opts.config}`)
    throw err
  }
  // Discovery path: silently fall back to no plugins.
  plugins = []
}
```

Then update the `attach()` call in the same file to pass `plugins` instead of `config.plugins`:

```ts
const handle = await attach(page, {
  outDir: opts.dir,
  plugins,
  testTitle: `debug: ${navigationUrl}`,
})
```

You'll need to import `IntrospectionPlugin` as well (from `@introspection/types`), if the `plugins` type annotation requires it. If TypeScript infers it fine, skip.

- [ ] **Step 3: Run CLI tests**

Run: `pnpm -F introspect test`
Expected: all existing tests PASS. Note the CLI package is named `introspect`, not `@introspection/cli` — use the actual name.

- [ ] **Step 4: Typecheck and build**

Run: `pnpm -F introspect typecheck && pnpm -F introspect build`
Expected: both PASS.

- [ ] **Step 5: Smoke test the `debug` command**

From repo root, run the command that the CLI tests already exercise to make sure the flow works end-to-end. This is belt-and-braces since the vitest suite already covers it. If the tests pass in step 3, skip this step.

- [ ] **Step 6: Commit**

```
git add packages/cli/package.json packages/cli/src/commands/debug.ts pnpm-lock.yaml
git commit -m "cli: use @introspection/config for loading + plugin resolution"
```

---

## Task 8: Document the package

**Files:**
- Create: `packages/config/README.md`

- [ ] **Step 1: Write the README**

Create `packages/config/README.md`:

```markdown
# @introspection/config

Shared config loading and plugin preset resolution for the introspection toolchain. Used by `@introspection/playwright` and `@introspection/cli`.

## API

### `loadPlugins(opts?) => Promise<IntrospectionPlugin[]>`

Sugar: find the nearest `introspect.config.{ts,mts,js,mjs}`, apply precedence rules, return the plugin array.

```ts
import { attach } from '@introspection/playwright'
import { loadPlugins } from '@introspection/config'

await attach(page, { plugins: await loadPlugins() })
```

Options:

| field | default | notes |
|---|---|---|
| `cwd` | `process.cwd()` | starting point for upward discovery |
| `configPath` | undefined | explicit path; errors if not found |
| `env` | `process.env` | source for `INTROSPECT_PRESET` |
| `optsPlugins` | undefined | passthrough override; skips config load |

### `loadIntrospectConfig(opts?) => Promise<IntrospectConfig | undefined>`

Pure loader. Walks up from `cwd` (or loads `configPath` directly). Returns `undefined` if nothing found on the discovery path. Throws on an explicit `configPath` that doesn't exist.

### `resolvePlugins(args) => IntrospectionPlugin[]`

Pure precedence logic. Takes `{ optsPlugins?, config?, env }` and applies:

1. `optsPlugins` — returned verbatim if provided.
2. `env.INTROSPECT_PRESET` — selects preset(s) from object-form config. Comma-separated values merge.
3. Array-form config — returned verbatim when no env preset is set.
4. Object-form config's `default` preset.
5. `[]`.

Errors:
- `INTROSPECT_PRESET` set with no config → throws.
- `INTROSPECT_PRESET` set with array-form config → throws.
- Unknown preset name → throws with available names.

## Config file shapes

**Array form** (single always-active set):

```ts
// introspect.config.ts
import { network } from '@introspection/plugin-network'
import type { IntrospectConfig } from '@introspection/types'

export default {
  plugins: [network()],
} satisfies IntrospectConfig
```

**Preset form** (`default` required):

```ts
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

Select a preset per run:

```
INTROSPECT_PRESET=network pnpm test
INTROSPECT_PRESET=network,state pnpm test    # merges
```
```

- [ ] **Step 2: Commit**

```
git add packages/config/README.md
git commit -m "config: document @introspection/config API"
```

---

## Self-review

**Spec coverage:**
- New package scaffolding (Task 1) — matches spec's "Package scaffolding" section.
- `resolvePlugins` pure function (Task 2) — matches API section 2 + error rules.
- `loadIntrospectConfig` (Task 3) — matches API section 1.
- `loadPlugins` sugar (Task 4) — matches API section 3.
- `attach()` revert (Task 5) — matches spec's "Consumer changes → @introspection/playwright".
- Playwright re-export wiring (Task 6) — matches same section.
- CLI migration (Task 7) — matches "Consumer changes → @introspection/cli".
- README (Task 8) — matches "Migration sequence → Docs".

**Placeholder scan:** none found.

**Type consistency:**
- `ResolvePluginsArgs`, `LoadConfigOptions`, `LoadPluginsOptions` used consistently.
- `IntrospectionPlugin` imported from `@introspection/types` everywhere.
- `IntrospectConfig`, `PluginSet` re-exported through `@introspection/config`.

**Out-of-scope items (deferred to future plans):**
- Extending `introspectFixture` to auto-call `loadPlugins()`.
- `services/integration-tests` migration.
- Step-wrapping / screenshot plugin.
