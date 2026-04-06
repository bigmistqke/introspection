# WebGL Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `@introspection/plugin-webgl` — a plugin that captures WebGL context lifecycle, uniform updates, draw calls, and texture binds via monkey-patching browser APIs, with full GL state snapshots on demand.

**Architecture:** Two-layer design. `browser.ts` is a self-contained browser-side script (bundled separately) that patches WebGL prototypes and exposes `window.__introspect_plugins__.webgl`. `index.ts` is the Node-side plugin factory that implements `IntrospectionPlugin`, stores `PluginContext` during `install()`, and exposes a typed `watch()` API that calls `ctx.addSubscription()`. Two-pass tsup build: browser bundle first, then Node bundle that embeds it as a string literal via placeholder substitution.

**Tech Stack:** TypeScript, tsup (two-pass, sequential), vitest (unit), `@playwright/test` (integration), `@introspection/types` (only runtime dep)

**Depends on:** Plugin system plan (`2026-04-06-plugin-system.md`) must be complete first. That plan adds `IntrospectionPlugin`, `PluginContext`, `PluginPage`, `WatchHandle`, `CaptureResult`, and `EventSource: 'plugin'` to `@introspection/types`.

**Test philosophy:** Browser-side interceptor behavior is tested in a real browser via Playwright — no WebGL stubs, no mocks, no "did it call X". Unit tests cover only non-obvious Node-side transformations (RegExp serialization). The TypeScript compiler handles interface shape.

---

## File Map

| File | Change | Responsibility |
|------|--------|----------------|
| `packages/plugin-webgl/package.json` | Create | Package manifest; deps on `@introspection/types`, `@introspection/playwright`; devDep on `@playwright/test` |
| `packages/plugin-webgl/tsup.browser.config.ts` | Create | Pass 1: browser IIFE bundle |
| `packages/plugin-webgl/tsup.node.config.ts` | Create | Pass 2: Node ESM bundle with browser script embedded |
| `packages/plugin-webgl/src/browser.ts` | Create | Browser-side script: always-active + lazy WebGL interceptors |
| `packages/plugin-webgl/src/index.ts` | Create | Node-side: `webgl()` factory, `IntrospectionPlugin` impl, typed `watch()` |
| `packages/plugin-webgl/test/unit.test.ts` | Create | Unit tests: RegExp serialization only |
| `packages/plugin-webgl/test/webgl.spec.ts` | Create | Playwright integration tests: real browser behavior |
| `packages/plugin-webgl/playwright.config.ts` | Create | Minimal Playwright config for this package |

---

### Task 1: Package scaffold

**Files:**
- Create: `packages/plugin-webgl/package.json`
- Create: `packages/plugin-webgl/tsup.browser.config.ts`
- Create: `packages/plugin-webgl/tsup.node.config.ts`
- Create: `packages/plugin-webgl/playwright.config.ts`

- [ ] **Step 1: Create `packages/plugin-webgl/package.json`**

```json
{
  "name": "@introspection/plugin-webgl",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup --config tsup.browser.config.ts && tsup --config tsup.node.config.ts",
    "test:unit": "vitest run",
    "test:integration": "playwright test",
    "test": "pnpm run test:unit && pnpm run test:integration"
  },
  "dependencies": {
    "@introspection/types": "workspace:*"
  },
  "devDependencies": {
    "@introspection/playwright": "workspace:*",
    "@playwright/test": "^1.40.0",
    "tsup": "^8.0.0",
    "vitest": "^1.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/plugin-webgl/tsup.browser.config.ts`**

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { browser: 'src/browser.ts' },
  outDir: 'dist',
  format: ['iife'],
  globalName: '__introspect_webgl_browser__',
  platform: 'browser',
  minify: false,
  outExtension: () => ({ js: '.iife.js' }),
  noExternal: [/.*/],
})
```

- [ ] **Step 3: Create `packages/plugin-webgl/tsup.node.config.ts`**

```ts
import { defineConfig } from 'tsup'
import { readFileSync } from 'fs'
import { resolve } from 'path'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  dts: true,
  esbuildPlugins: [
    {
      name: 'embed-browser-script',
      setup(build) {
        build.onLoad({ filter: /src\/index\.ts$/ }, async (args) => {
          const src = readFileSync(args.path, 'utf-8')
          const browserScript = readFileSync(resolve('dist/browser.iife.js'), 'utf-8')
          const result = src.replace("'__BROWSER_SCRIPT_PLACEHOLDER__'", JSON.stringify(browserScript))
          return { contents: result, loader: 'ts' }
        })
      },
    },
  ],
})
```

- [ ] **Step 4: Create `packages/plugin-webgl/playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  use: {
    headless: true,
    launchOptions: {
      args: ['--enable-webgl', '--use-gl=swiftshader'],
    },
  },
})
```

Note: `--use-gl=swiftshader` ensures WebGL works in headless Chromium (software renderer).

- [ ] **Step 5: Install and verify workspace picks up the package**

```
pnpm install
```

Expected: `@introspection/plugin-webgl` appears in workspace.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-webgl/
git commit -m "feat(plugin-webgl): add package scaffold with sequential two-pass tsup config and playwright setup"
```

---

### Task 2: Browser-side script

**Files:**
- Create: `packages/plugin-webgl/src/browser.ts`

This file is bundled independently — no imports, no external deps. It runs in the browser before any app code.

- [ ] **Step 1: Write a failing integration test first**

Create `packages/plugin-webgl/test/webgl.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

// Helpers defined here — expanded in later tasks
async function getEvents(outDir: string) {
  const [sessionId] = await readdir(outDir)
  return (await readFile(join(outDir, sessionId, 'events.ndjson'), 'utf-8'))
    .trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
}

test('webgl.context-created fires when getContext("webgl") is called', async ({ page }) => {
  // Dynamic import — will fail until index.ts exists
  const { webgl } = await import('../src/index.js')
  const { attach } = await import('@introspection/playwright')

  const outDir = await mkdtemp(join(tmpdir(), 'introspect-webgl-'))
  try {
    const plugin = webgl()
    const handle = await attach(page, { outDir, plugins: [plugin] })

    await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      document.body.appendChild(canvas)
      canvas.getContext('webgl')
    })

    await handle.detach()
    const events = await getEvents(outDir)
    const created = events.find((e: { type: string }) => e.type === 'webgl.context-created')
    expect(created).toBeDefined()
    expect(created.source).toBe('plugin')
    expect(created.data.contextId).toBeDefined()
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run to verify it fails**

```
cd packages/plugin-webgl && pnpm run test:integration
```

Expected: fails — `../src/index.js` not found.

- [ ] **Step 3: Create `packages/plugin-webgl/src/browser.ts`**

```ts
// Browser-side WebGL instrumentation script.
// Bundled as IIFE and embedded into index.ts at build time.
// No imports — runs standalone in the browser.

;(() => {
  type GL = WebGLRenderingContext | WebGL2RenderingContext

  // ─── State ───────────────────────────────────────────────────────────────────

  // Plain Map (not WeakMap) — getState() needs to iterate all active contexts
  const contextIds = new Map<GL, string>()
  const locationNames = new WeakMap<WebGLUniformLocation, string>()
  const textureIds = new WeakMap<WebGLTexture, number>()
  const textureCounters = new Map<GL, number>()

  interface Subscription { id: string; spec: Record<string, unknown> }
  const subscriptions = new Map<string, Subscription>()
  let subCounter = 0

  const refCounts: Record<string, number> = { uniform: 0, draw: 0, 'texture-bind': 0 }
  const lastUniformValue = new Map<string, unknown>()

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function push(type: string, data: Record<string, unknown>): void {
    ;(window as unknown as { __introspect_push__: (s: string) => void }).__introspect_push__(
      JSON.stringify({ type, data })
    )
  }

  function getContextId(gl: GL): string {
    return contextIds.get(gl) ?? '<unknown>'
  }

  function getUniformName(location: WebGLUniformLocation | null): string {
    if (location === null) return '<null>'
    return locationNames.get(location) ?? `<unknown:${String(location)}>`
  }

  function glConstantName(gl: GL, value: number): string {
    const names: Record<number, string> = {
      [gl.TRIANGLES]: 'TRIANGLES', [gl.LINES]: 'LINES', [gl.POINTS]: 'POINTS',
      [gl.LINE_STRIP]: 'LINE_STRIP', [gl.LINE_LOOP]: 'LINE_LOOP',
      [gl.TRIANGLE_STRIP]: 'TRIANGLE_STRIP', [gl.TRIANGLE_FAN]: 'TRIANGLE_FAN',
    }
    return names[value] ?? String(value)
  }

  function indexTypeName(gl: GL, value: number): string {
    const names: Record<number, string> = {
      [gl.UNSIGNED_BYTE]: 'UNSIGNED_BYTE', [gl.UNSIGNED_SHORT]: 'UNSIGNED_SHORT',
      [(gl as WebGL2RenderingContext).UNSIGNED_INT ?? 5125]: 'UNSIGNED_INT',
    }
    return names[value] ?? String(value)
  }

  function matchesSpec(spec: Record<string, unknown>, contextId: string, name?: string): boolean {
    if (spec.contextId !== undefined && spec.contextId !== contextId) return false
    if (name !== undefined && spec.name !== undefined) {
      if (typeof spec.name === 'string') {
        if (spec.name !== name) return false
      } else if (spec.name && typeof spec.name === 'object') {
        const { source, flags } = spec.name as { source: string; flags: string }
        if (!new RegExp(source, flags).test(name)) return false
      }
    }
    return true
  }

  // ─── Always-active interceptors ──────────────────────────────────────────────

  const origGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof origGetContext>) {
    const ctx = origGetContext.apply(this, args)
    if (ctx instanceof WebGLRenderingContext || ctx instanceof WebGL2RenderingContext) {
      if (!contextIds.has(ctx)) {
        const id = crypto.randomUUID()
        contextIds.set(ctx, id)
        textureCounters.set(ctx, 0)
        ctx.canvas.addEventListener('webglcontextlost', () => {
          push('webgl.context-lost', { contextId: id })
          for (const key of lastUniformValue.keys()) {
            if (key.startsWith(`${id}:`)) lastUniformValue.delete(key)
          }
        })
        ctx.canvas.addEventListener('webglcontextrestored', () => {
          push('webgl.context-restored', { contextId: id })
        })
        push('webgl.context-created', { contextId: id })
      }
    }
    return ctx
  } as typeof origGetContext

  function patchGetUniformLocation(proto: WebGLRenderingContext): void {
    const orig = proto.getUniformLocation
    proto.getUniformLocation = function (program, name) {
      const location = orig.call(this, program, name)
      if (location !== null) locationNames.set(location, name)
      return location
    }
  }
  patchGetUniformLocation(WebGLRenderingContext.prototype)
  if (typeof WebGL2RenderingContext !== 'undefined') patchGetUniformLocation(WebGL2RenderingContext.prototype as unknown as WebGLRenderingContext)

  function patchCreateTexture(proto: WebGLRenderingContext): void {
    const orig = proto.createTexture
    proto.createTexture = function () {
      const texture = orig.call(this)
      if (texture !== null) {
        const counter = (textureCounters.get(this as GL) ?? 0) + 1
        textureCounters.set(this as GL, counter)
        textureIds.set(texture, counter)
      }
      return texture
    }
  }
  patchCreateTexture(WebGLRenderingContext.prototype)
  if (typeof WebGL2RenderingContext !== 'undefined') patchCreateTexture(WebGL2RenderingContext.prototype as unknown as WebGLRenderingContext)

  // ─── Lazy interceptors ───────────────────────────────────────────────────────

  const uniformMethods = [
    'uniform1f','uniform1fv','uniform2f','uniform2fv','uniform3f','uniform3fv','uniform4f','uniform4fv',
    'uniform1i','uniform1iv','uniform2i','uniform2iv','uniform3i','uniform3iv','uniform4i','uniform4iv',
    'uniformMatrix2fv','uniformMatrix3fv','uniformMatrix4fv',
  ] as const

  const glTypeFor: Record<string, string> = {
    uniform1f:'float', uniform1fv:'float', uniform2f:'vec2', uniform2fv:'vec2',
    uniform3f:'vec3', uniform3fv:'vec3', uniform4f:'vec4', uniform4fv:'vec4',
    uniform1i:'int', uniform1iv:'int', uniform2i:'ivec2', uniform2iv:'ivec2',
    uniform3i:'ivec3', uniform3iv:'ivec3', uniform4i:'ivec4', uniform4iv:'ivec4',
    uniformMatrix2fv:'mat2', uniformMatrix3fv:'mat3', uniformMatrix4fv:'mat4',
  }

  const lazyCleanups: Partial<Record<string, () => void>> = {}

  function installUniforms(): () => void {
    const originals: Array<[object, string, unknown]> = []
    const protos = [WebGLRenderingContext.prototype, ...(typeof WebGL2RenderingContext !== 'undefined' ? [WebGL2RenderingContext.prototype] : [])]
    for (const proto of protos) {
      for (const method of uniformMethods) {
        const orig = (proto as Record<string, unknown>)[method] as (...a: unknown[]) => void
        originals.push([proto, method, orig])
        const glType = glTypeFor[method]
        ;(proto as Record<string, unknown>)[method] = function (this: GL, location: WebGLUniformLocation | null, ...rest: unknown[]) {
          orig.call(this, location, ...rest)
          const contextId = getContextId(this)
          const name = getUniformName(location)
          const value = rest[0]
          for (const sub of subscriptions.values()) {
            if (sub.spec.event !== 'uniform') continue
            if (!matchesSpec(sub.spec, contextId, name)) continue
            if (sub.spec.valueChanged) {
              const key = `${contextId}:${name}`
              if (JSON.stringify(lastUniformValue.get(key)) === JSON.stringify(value)) continue
              lastUniformValue.set(key, value)
            }
            push('webgl.uniform', { contextId, name, value, glType })
          }
        }
      }
    }
    return () => { for (const [proto, method, orig] of originals) (proto as Record<string, unknown>)[method] = orig }
  }

  function installDraw(): () => void {
    const cleanups: Array<() => void> = []
    const protos = [WebGLRenderingContext.prototype, ...(typeof WebGL2RenderingContext !== 'undefined' ? [WebGL2RenderingContext.prototype] : [])]
    for (const proto of protos) {
      const origArrays = proto.drawArrays
      proto.drawArrays = function (this: GL, mode, first, count) {
        origArrays.call(this, mode, first, count)
        const contextId = getContextId(this)
        const primitive = glConstantName(this, mode)
        for (const sub of subscriptions.values()) {
          if (sub.spec.event !== 'draw') continue
          if (sub.spec.contextId !== undefined && sub.spec.contextId !== contextId) continue
          if (sub.spec.primitive !== undefined && sub.spec.primitive !== primitive) continue
          push('webgl.draw-arrays', { contextId, primitive, first, count })
        }
      }
      const origElements = proto.drawElements
      proto.drawElements = function (this: GL, mode, count, type, offset) {
        origElements.call(this, mode, count, type, offset)
        const contextId = getContextId(this)
        const primitive = glConstantName(this, mode)
        for (const sub of subscriptions.values()) {
          if (sub.spec.event !== 'draw') continue
          if (sub.spec.contextId !== undefined && sub.spec.contextId !== contextId) continue
          if (sub.spec.primitive !== undefined && sub.spec.primitive !== primitive) continue
          push('webgl.draw-elements', { contextId, primitive, count, indexType: indexTypeName(this, type), offset })
        }
      }
      cleanups.push(() => { proto.drawArrays = origArrays; proto.drawElements = origElements })
    }
    return () => cleanups.forEach(c => c())
  }

  function installTextureBind(): () => void {
    const cleanups: Array<() => void> = []
    const protos = [WebGLRenderingContext.prototype, ...(typeof WebGL2RenderingContext !== 'undefined' ? [WebGL2RenderingContext.prototype] : [])]
    for (const proto of protos) {
      const orig = proto.bindTexture
      proto.bindTexture = function (this: GL, target, texture) {
        orig.call(this, target, texture)
        const contextId = getContextId(this)
        const unit = this.getParameter(this.ACTIVE_TEXTURE) - this.TEXTURE0
        const textureId = texture !== null ? (textureIds.get(texture) ?? null) : null
        const targetName = target === this.TEXTURE_2D ? 'TEXTURE_2D' : 'TEXTURE_CUBE_MAP'
        for (const sub of subscriptions.values()) {
          if (sub.spec.event !== 'texture-bind') continue
          if (sub.spec.contextId !== undefined && sub.spec.contextId !== contextId) continue
          if (sub.spec.unit !== undefined && sub.spec.unit !== unit) continue
          push('webgl.texture-bind', { contextId, unit, target: targetName, textureId })
        }
      }
      cleanups.push(() => { proto.bindTexture = orig })
    }
    return () => cleanups.forEach(c => c())
  }

  function installLazy(event: string): void {
    refCounts[event] = (refCounts[event] ?? 0) + 1
    if (refCounts[event] !== 1) return
    if (event === 'uniform') lazyCleanups[event] = installUniforms()
    else if (event === 'draw') lazyCleanups[event] = installDraw()
    else if (event === 'texture-bind') lazyCleanups[event] = installTextureBind()
  }

  function uninstallLazy(event: string): void {
    refCounts[event] = Math.max(0, (refCounts[event] ?? 0) - 1)
    if (refCounts[event] === 0) { lazyCleanups[event]?.(); delete lazyCleanups[event] }
  }

  // ─── GL state capture ─────────────────────────────────────────────────────────

  interface WebGLStateSnapshot {
    contextId: string
    uniforms: Record<string, { value: unknown; glType: string }>
    textures: Array<{ unit: number; target: string; textureId: number | null }>
    viewport: [number, number, number, number]
    blendState: { enabled: boolean; srcRgb: number; dstRgb: number; srcAlpha: number; dstAlpha: number; equation: number }
    depthState: { testEnabled: boolean; func: number; writeMask: boolean }
  }

  function getState(): WebGLStateSnapshot[] {
    return Array.from(contextIds.entries()).map(([gl, id]) => {
      const textures: Array<{ unit: number; target: string; textureId: number | null }> = []
      const savedActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number
      for (let unit = 0; unit < 32; unit++) {
        gl.activeTexture(gl.TEXTURE0 + unit)
        const bound2d = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null
        const boundCube = gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP) as WebGLTexture | null
        if (bound2d) textures.push({ unit, target: 'TEXTURE_2D', textureId: textureIds.get(bound2d) ?? null })
        if (boundCube) textures.push({ unit, target: 'TEXTURE_CUBE_MAP', textureId: textureIds.get(boundCube) ?? null })
      }
      gl.activeTexture(savedActiveTexture)  // restore — do not corrupt app state

      return {
        contextId: id,
        uniforms: {},  // WebGL has no API to read back uniform values
        textures,
        viewport: Array.from(gl.getParameter(gl.VIEWPORT)) as [number, number, number, number],
        blendState: {
          enabled: gl.isEnabled(gl.BLEND),
          srcRgb: gl.getParameter(gl.BLEND_SRC_RGB) as number,
          dstRgb: gl.getParameter(gl.BLEND_DST_RGB) as number,
          srcAlpha: gl.getParameter(gl.BLEND_SRC_ALPHA) as number,
          dstAlpha: gl.getParameter(gl.BLEND_DST_ALPHA) as number,
          equation: gl.getParameter(gl.BLEND_EQUATION_RGB) as number,
        },
        depthState: {
          testEnabled: gl.isEnabled(gl.DEPTH_TEST),
          func: gl.getParameter(gl.DEPTH_FUNC) as number,
          writeMask: gl.getParameter(gl.DEPTH_WRITEMASK) as boolean,
        },
      }
    })
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  window.__introspect_plugins__ = window.__introspect_plugins__ || {}
  ;(window.__introspect_plugins__ as Record<string, unknown>).webgl = {
    watch(spec: Record<string, unknown>): string {
      const id = String(subCounter++)
      installLazy(spec.event as string)
      subscriptions.set(id, { id, spec })
      return id
    },
    unwatch(id: string): void {
      const sub = subscriptions.get(id)
      if (!sub) return
      subscriptions.delete(id)
      uninstallLazy(sub.spec.event as string)
    },
    getState,
  }
})()
```

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-webgl/src/browser.ts
git commit -m "feat(plugin-webgl): add browser-side script — always-active + lazy WebGL interceptors with getState()"
```

---

### Task 3: Node-side plugin factory

**Files:**
- Create: `packages/plugin-webgl/src/index.ts`
- Create: `packages/plugin-webgl/test/unit.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `packages/plugin-webgl/test/unit.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import type { PluginContext } from '@introspection/types'

describe('webgl() — Node-side', () => {
  it('has name "webgl" and a non-empty script', async () => {
    const { webgl } = await import('../src/index.js')
    const plugin = webgl()
    expect(plugin.name).toBe('webgl')
    expect(plugin.script.length).toBeGreaterThan(0)
  })

  it('watch() serialises RegExp name filter as { source, flags }', async () => {
    const { webgl } = await import('../src/index.js')
    const plugin = webgl()
    const addSubscription = vi.fn().mockResolvedValue({ unwatch: vi.fn() })
    await plugin.install({ addSubscription, page: { evaluate: vi.fn() }, cdpSession: { send: vi.fn() }, emit: vi.fn(), writeAsset: vi.fn(), timestamp: () => 0 } as unknown as PluginContext)
    await plugin.watch({ event: 'uniform', name: /^u_/ })
    expect(addSubscription).toHaveBeenCalledWith('webgl', expect.objectContaining({
      name: { source: '^u_', flags: '' },
    }))
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

```
cd packages/plugin-webgl && pnpm run test:unit
```

Expected: fails — `../src/index.js` not found.

- [ ] **Step 3: Create `packages/plugin-webgl/src/index.ts`**

```ts
import type { IntrospectionPlugin, PluginContext, WatchHandle, CaptureResult } from '@introspection/types'

const BROWSER_SCRIPT = '__BROWSER_SCRIPT_PLACEHOLDER__'

export type NameFilter = string | RegExp

function serialiseName(name: NameFilter | undefined): string | { source: string; flags: string } | undefined {
  if (name === undefined) return undefined
  if (typeof name === 'string') return name
  return { source: name.source, flags: name.flags }
}

export interface UniformWatchOpts {
  event: 'uniform'
  contextId?: string
  name?: NameFilter
  valueChanged?: boolean
}

export interface DrawWatchOpts {
  event: 'draw'
  contextId?: string
  primitive?: 'TRIANGLES' | 'LINES' | 'POINTS' | 'LINE_STRIP' | 'LINE_LOOP' | 'TRIANGLE_STRIP' | 'TRIANGLE_FAN'
}

export interface TextureBindWatchOpts {
  event: 'texture-bind'
  contextId?: string
  unit?: number
}

export type WebGLWatchOpts = UniformWatchOpts | DrawWatchOpts | TextureBindWatchOpts

export interface WebGLStateSnapshot {
  contextId: string
  uniforms: Record<string, { value: unknown; glType: string }>
  textures: Array<{ unit: number; target: string; textureId: number | null }>
  viewport: [number, number, number, number]
  blendState: { enabled: boolean; srcRgb: number; dstRgb: number; srcAlpha: number; dstAlpha: number; equation: number }
  depthState: { testEnabled: boolean; func: number; writeMask: boolean }
}

export interface WebGLPlugin extends IntrospectionPlugin {
  watch(opts: WebGLWatchOpts): Promise<WatchHandle>
}

export function webgl(): WebGLPlugin {
  let ctx: PluginContext | null = null

  return {
    name: 'webgl',
    script: BROWSER_SCRIPT,

    async install(pluginCtx: PluginContext): Promise<void> {
      ctx = pluginCtx
    },

    async watch(opts: WebGLWatchOpts): Promise<WatchHandle> {
      if (!ctx) throw new Error('webgl plugin: watch() called before install()')
      let spec: Record<string, unknown>
      if (opts.event === 'uniform') {
        spec = {
          event: 'uniform',
          ...(opts.contextId !== undefined && { contextId: opts.contextId }),
          ...(opts.name !== undefined && { name: serialiseName(opts.name) }),
          ...(opts.valueChanged !== undefined && { valueChanged: opts.valueChanged }),
        }
      } else if (opts.event === 'draw') {
        spec = {
          event: 'draw',
          ...(opts.contextId !== undefined && { contextId: opts.contextId }),
          ...(opts.primitive !== undefined && { primitive: opts.primitive }),
        }
      } else {
        spec = {
          event: 'texture-bind',
          ...(opts.contextId !== undefined && { contextId: opts.contextId }),
          ...((opts as TextureBindWatchOpts).unit !== undefined && { unit: (opts as TextureBindWatchOpts).unit }),
        }
      }
      return ctx.addSubscription('webgl', spec)
    },

    async capture(_trigger: 'js.error' | 'manual' | 'detach', ts: number): Promise<CaptureResult[]> {
      if (!ctx) return []
      const snapshots = await ctx.page.evaluate(() => {
        return (window.__introspect_plugins__ as { webgl?: { getState?(): unknown[] } })?.webgl?.getState?.() ?? []
      }) as WebGLStateSnapshot[]
      return snapshots.map(snapshot => ({
        kind: 'webgl-state',
        content: JSON.stringify(snapshot),
        summary: {
          contextId: snapshot.contextId,
          uniformCount: Object.keys(snapshot.uniforms).length,
          boundTextureCount: snapshot.textures.length,
          viewport: snapshot.viewport,
          timestamp: ts,
        },
      }))
    },
  }
}
```

- [ ] **Step 4: Run unit tests**

```
cd packages/plugin-webgl && pnpm run test:unit
```

Expected: both pass. Note: `plugin.script` will be the literal placeholder string `'__BROWSER_SCRIPT_PLACEHOLDER__'` at this point (embedding happens at build time) — `length > 0` passes.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-webgl/src/index.ts packages/plugin-webgl/test/unit.test.ts
git commit -m "feat(plugin-webgl): add Node-side plugin factory with typed watch() and capture()"
```

---

### Task 4: Playwright integration tests

**Files:**
- Modify: `packages/plugin-webgl/test/webgl.spec.ts`

These tests use a real browser. They test actual interceptor behavior — not mocks.

A minimal WebGL helper is needed for uniform tests (requires a linked shader program):

```ts
// In the browser page — sets up a tiny GL program, returns nothing
// (all interaction goes through the WebGL interceptor → push events)
function setupGL() {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  const gl = canvas.getContext('webgl')!

  const vs = gl.createShader(gl.VERTEX_SHADER)!
  gl.shaderSource(vs, `
    uniform float u_time;
    uniform vec2 u_resolution;
    attribute vec4 a_pos;
    void main() { gl_Position = a_pos * u_time; }
  `)
  gl.compileShader(vs)

  // Fragment shader (required for link)
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!
  gl.shaderSource(fs, 'void main() { gl_FragColor = vec4(1.0); }')
  gl.compileShader(fs)

  const prog = gl.createProgram()!
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.useProgram(prog)

  // Store on window so subsequent evaluate() calls can use it
  ;(window as unknown as { _gl: WebGLRenderingContext; _prog: WebGLProgram }).
    _gl = gl
  ;(window as unknown as { _gl: WebGLRenderingContext; _prog: WebGLProgram }).
    _prog = prog
}
```

- [ ] **Step 1: Build the browser bundle first (needed for integration tests)**

```
cd packages/plugin-webgl && pnpm build
```

Expected: `dist/browser.iife.js` and `dist/index.js` created.

- [ ] **Step 2: Write integration tests**

Replace `packages/plugin-webgl/test/webgl.spec.ts` with:

```ts
import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { webgl } from '../src/index.js'
import { attach } from '@introspection/playwright'
import type { IntrospectHandle } from '@introspection/types'

// ─── Test helpers ─────────────────────────────────────────────────────────────

async function makeSession(page: import('@playwright/test').Page) {
  const outDir = await mkdtemp(join(tmpdir(), 'introspect-webgl-'))
  const plugin = webgl()
  const handle = await attach(page, { outDir, plugins: [plugin] })
  return { outDir, plugin, handle }
}

async function endSession(handle: IntrospectHandle, outDir: string) {
  await handle.detach()
  const [sessionId] = await readdir(outDir)
  const raw = await readFile(join(outDir, sessionId, 'events.ndjson'), 'utf-8')
  await rm(outDir, { recursive: true, force: true })
  return raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
}

// Sets up a minimal linked WebGL program on the page.
// Stores gl and prog on window._gl / window._prog for later evaluate() calls.
async function setupGL(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    const gl = canvas.getContext('webgl')!
    const vs = gl.createShader(gl.VERTEX_SHADER)!
    gl.shaderSource(vs, 'uniform float u_time; uniform vec2 u_resolution; attribute vec4 p; void main(){gl_Position=p*u_time;}')
    gl.compileShader(vs)
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!
    gl.shaderSource(fs, 'void main(){gl_FragColor=vec4(1.0);}')
    gl.compileShader(fs)
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); gl.useProgram(prog)
    ;(window as unknown as Record<string, unknown>)._gl = gl
    ;(window as unknown as Record<string, unknown>)._prog = prog
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('webgl.context-created fires when getContext("webgl") is called', async ({ page }) => {
  const { outDir, handle } = await makeSession(page)

  await page.evaluate(() => {
    document.createElement('canvas').getContext('webgl')
  })

  const events = await endSession(handle, outDir)
  const created = events.find((e: { type: string }) => e.type === 'webgl.context-created')
  expect(created).toBeDefined()
  expect(created.source).toBe('plugin')
  expect(typeof created.data.contextId).toBe('string')
})

test('uniform1f push event has correct name, value, and glType', async ({ page }) => {
  const { outDir, plugin, handle } = await makeSession(page)
  await setupGL(page)
  await plugin.watch({ event: 'uniform', name: 'u_time' })

  await page.evaluate(() => {
    const { _gl: gl, _prog: prog } = window as unknown as { _gl: WebGLRenderingContext; _prog: WebGLProgram }
    gl.uniform1f(gl.getUniformLocation(prog, 'u_time'), 1.5)
  })

  const events = await endSession(handle, outDir)
  const uniform = events.find((e: { type: string; data?: { name: string } }) =>
    e.type === 'webgl.uniform' && e.data?.name === 'u_time')
  expect(uniform).toBeDefined()
  expect(uniform.data.value).toBe(1.5)
  expect(uniform.data.glType).toBe('float')
  expect(uniform.source).toBe('plugin')
})

test('valueChanged suppresses duplicate values, fires on change', async ({ page }) => {
  const { outDir, plugin, handle } = await makeSession(page)
  await setupGL(page)
  await plugin.watch({ event: 'uniform', name: 'u_time', valueChanged: true })

  await page.evaluate(() => {
    const { _gl: gl, _prog: prog } = window as unknown as { _gl: WebGLRenderingContext; _prog: WebGLProgram }
    const loc = gl.getUniformLocation(prog, 'u_time')
    gl.uniform1f(loc, 2.0)  // fires
    gl.uniform1f(loc, 2.0)  // suppressed — same value
    gl.uniform1f(loc, 3.0)  // fires — different value
  })

  const events = await endSession(handle, outDir)
  const uniforms = events.filter((e: { type: string; data?: { name: string } }) =>
    e.type === 'webgl.uniform' && e.data?.name === 'u_time')
  expect(uniforms).toHaveLength(2)
  expect(uniforms[0].data.value).toBe(2.0)
  expect(uniforms[1].data.value).toBe(3.0)
})

test('drawArrays push event has correct primitive name', async ({ page }) => {
  const { outDir, plugin, handle } = await makeSession(page)
  await setupGL(page)
  await plugin.watch({ event: 'draw' })

  await page.evaluate(() => {
    const { _gl: gl } = window as unknown as { _gl: WebGLRenderingContext }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  })

  const events = await endSession(handle, outDir)
  const draw = events.find((e: { type: string }) => e.type === 'webgl.draw-arrays')
  expect(draw).toBeDefined()
  expect(draw.data.primitive).toBe('TRIANGLES')
  expect(draw.data.first).toBe(0)
  expect(draw.data.count).toBe(3)
})

test('unwatch stops events from being pushed', async ({ page }) => {
  const { outDir, plugin, handle } = await makeSession(page)
  await setupGL(page)
  const wh = await plugin.watch({ event: 'draw' })

  await page.evaluate(() => {
    ;(window as unknown as { _gl: WebGLRenderingContext })._gl.drawArrays(
      (window as unknown as { _gl: WebGLRenderingContext })._gl.TRIANGLES, 0, 3)
  })
  await wh.unwatch()
  await page.evaluate(() => {
    ;(window as unknown as { _gl: WebGLRenderingContext })._gl.drawArrays(
      (window as unknown as { _gl: WebGLRenderingContext })._gl.TRIANGLES, 0, 3)
  })

  const events = await endSession(handle, outDir)
  const draws = events.filter((e: { type: string }) => e.type === 'webgl.draw-arrays')
  expect(draws).toHaveLength(1)  // only the one before unwatch
})

test('capture() returns webgl-state asset with viewport and context info', async ({ page }) => {
  const { outDir, plugin, handle } = await makeSession(page)
  await setupGL(page)

  await handle.snapshot()  // triggers plugin.capture('manual')
  const events = await endSession(handle, outDir)

  const asset = events.find((e: { type: string; data?: { kind: string } }) =>
    e.type === 'asset' && e.data?.kind === 'webgl-state')
  expect(asset).toBeDefined()
  expect(asset.source).toBe('plugin')
  expect(asset.data.contextId).toBeDefined()
  expect(Array.isArray(asset.data.viewport)).toBe(true)
})
```

- [ ] **Step 3: Run integration tests**

```
cd packages/plugin-webgl && pnpm run test:integration
```

Expected: all pass.

If WebGL is unavailable in headless Chromium: verify the `--use-gl=swiftshader` flag is in `playwright.config.ts`. If still failing, try `--enable-unsafe-webgpu` or check Chromium's WebGL support in the environment.

- [ ] **Step 4: Run unit tests too**

```
cd packages/plugin-webgl && pnpm run test:unit
```

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-webgl/test/webgl.spec.ts packages/plugin-webgl/test/unit.test.ts
git commit -m "test(plugin-webgl): Playwright integration tests for WebGL interceptor behavior"
```

---

### Task 5: Build verification and workspace check

- [ ] **Step 1: Full build**

```
cd packages/plugin-webgl && pnpm build
```

Verify placeholder is gone from the built output:
```
grep '__BROWSER_SCRIPT_PLACEHOLDER__' dist/index.js && echo "ERROR: placeholder not replaced" || echo "OK"
```

- [ ] **Step 2: Run all workspace tests**

```
pnpm -r test
```

Expected: all packages pass.

- [ ] **Step 3: Commit if any loose changes remain**

```bash
git add -p && git commit -m "chore(plugin-webgl): build verification"
```
