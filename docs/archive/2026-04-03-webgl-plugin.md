# WebGL Introspection Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@introspection/plugin-webgl` — a browser-side WebGL introspection plugin that tracks draw calls, shaders, textures, frame stats, and GL errors via explicit `plugin.track(gl)` opt-in.

**Architecture:** The plugin wraps GL contexts in a `Proxy` via `plugin.track(gl)`. Browser-side Maps track shaders, programs, textures, and contexts. A frame accumulator counts draw calls, primitive counts, and errors per frame. `plugin.frame()` emits accumulated stats; `plugin.stateSnapshot()` emits the full in-memory state. No server-side changes — all events are plain `PluginEvent` objects that flow through the existing server unchanged.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces. No new server-side dependencies.

---

## File Map

**New files:**
- `packages/plugin-webgl/package.json`
- `packages/plugin-webgl/tsconfig.json`
- `packages/plugin-webgl/src/index.ts` — all implementation
- `packages/plugin-webgl/test/plugin-webgl.test.ts` — all tests

**No existing files modified.**

---

## Task 1: Package scaffold

**Files:**
- Create: `packages/plugin-webgl/package.json`
- Create: `packages/plugin-webgl/tsconfig.json`
- Create: `packages/plugin-webgl/src/index.ts` (stub)
- Create: `packages/plugin-webgl/test/plugin-webgl.test.ts` (stub)

- [ ] **Step 1: Create `packages/plugin-webgl/package.json`**

```json
{
  "name": "@introspection/plugin-webgl",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run"
  },
  "dependencies": {
    "@introspection/types": "workspace:*"
  }
}
```

- [ ] **Step 2: Create `packages/plugin-webgl/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create stub `packages/plugin-webgl/src/index.ts`**

```ts
import type { IntrospectionPlugin, BrowserAgent } from '@introspection/types'

export interface WebGLPlugin extends IntrospectionPlugin {
  track<T extends WebGLRenderingContext | WebGL2RenderingContext>(gl: T): T
  frame(): void
  stateSnapshot(): void
}

export function createWebGLPlugin(): WebGLPlugin {
  throw new Error('not implemented')
}
```

- [ ] **Step 4: Create stub test file `packages/plugin-webgl/test/plugin-webgl.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { createWebGLPlugin } from '../src/index.js'

describe('createWebGLPlugin()', () => {
  it.todo('placeholder')
})
```

- [ ] **Step 5: Install workspace dependencies**

Run from repo root:

```bash
pnpm install
```

Expected: no errors, `@introspection/plugin-webgl` visible in workspace.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd packages/plugin-webgl && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-webgl/
git commit -m "feat(plugin-webgl): scaffold package"
```

---

## Task 2: `track()`, draw call interception, `frame()`

**Files:**
- Modify: `packages/plugin-webgl/src/index.ts`
- Modify: `packages/plugin-webgl/test/plugin-webgl.test.ts`

This task implements the core of the plugin. `track(gl)` returns a Proxy that intercepts draw calls and error checks. `frame()` emits accumulated stats and resets.

**WebGL mock pattern:** A plain object with `vi.fn()` methods — no browser needed. The mock needs GL constants as plain number properties (e.g. `COMPILE_STATUS: 0x8B81`).

**`primitiveCount`** is the raw `count` argument to `drawArrays`/`drawElements` — not topology-adjusted.

**GL error names** to map: `0x0500` → `'INVALID_ENUM'`, `0x0501` → `'INVALID_VALUE'`, `0x0502` → `'INVALID_OPERATION'`, `0x0505` → `'OUT_OF_MEMORY'`, `0x0506` → `'INVALID_FRAMEBUFFER_OPERATION'`. Unknown codes: `'0x' + code.toString(16)`.

**Texture tracking requires `bindTexture` interception.** `texImage2D` / `texImage3D` operate on the *currently bound* texture — the texture object is never passed as an argument. The plugin maintains a `currentTexture: Map<number, object>` (GL target enum → texture object) updated by intercepting `bindTexture`. `texImage2D` / `texImage3D` then look up `currentTexture.get(target)` to find the texture to key off.

- [ ] **Step 1: Write failing tests**

```ts
// packages/plugin-webgl/test/plugin-webgl.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWebGLPlugin } from '../src/index.js'
import type { BrowserAgent } from '@introspection/types'

function mockGl() {
  return {
    drawArrays: vi.fn(),
    drawElements: vi.fn(),
    drawArraysInstanced: vi.fn(),
    drawElementsInstanced: vi.fn(),
    getError: vi.fn().mockReturnValue(0),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn().mockReturnValue(true),
    getShaderInfoLog: vi.fn().mockReturnValue(''),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn().mockImplementation((_p: unknown, param: number) => {
      if (param === 0x8B82) return true   // LINK_STATUS
      if (param === 0x8B86) return 0      // ACTIVE_UNIFORMS
      if (param === 0x8B89) return 0      // ACTIVE_ATTRIBUTES
      return null
    }),
    getProgramInfoLog: vi.fn().mockReturnValue(''),
    getActiveUniform: vi.fn(),
    getActiveAttrib: vi.fn(),
    texImage2D: vi.fn(),
    texImage3D: vi.fn(),
    bindTexture: vi.fn(),
    canvas: { id: 'my-canvas', addEventListener: vi.fn() } as unknown as HTMLCanvasElement,
    COMPILE_STATUS: 0x8B81,
    LINK_STATUS: 0x8B82,
    ACTIVE_UNIFORMS: 0x8B86,
    ACTIVE_ATTRIBUTES: 0x8B89,
  }
}

describe('createWebGLPlugin()', () => {
  let agent: BrowserAgent
  let emitMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    emitMock = vi.fn()
    agent = { emit: emitMock }
  })

  it('has name "webgl"', () => {
    expect(createWebGLPlugin().name).toBe('webgl')
  })

  it('track() calls through to original on drawArrays', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    const proxied = plugin.track(gl as never)
    proxied.drawArrays(4, 0, 3)
    expect(gl.drawArrays).toHaveBeenCalledWith(4, 0, 3)
  })

  it('drawArrays increments drawCalls and primitiveCount', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    const proxied = plugin.track(gl as never)
    proxied.drawArrays(4, 0, 6)
    proxied.drawArrays(4, 0, 3)
    plugin.frame()
    const call = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.frame')!
    expect(call[0].data.drawCalls).toBe(2)
    expect(call[0].data.primitiveCount).toBe(9)
  })

  it('frame() resets accumulator after emitting', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    const proxied = plugin.track(gl as never)
    proxied.drawArrays(4, 0, 3)
    plugin.frame()
    emitMock.mockClear()
    plugin.frame()
    const call = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.frame')!
    expect(call[0].data.drawCalls).toBe(0)
    expect(call[0].data.primitiveCount).toBe(0)
  })

  it('frame() emits contextCount', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    plugin.track(mockGl() as never)
    plugin.track(mockGl() as never)
    plugin.frame()
    const call = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.frame')!
    expect(call[0].data.contextCount).toBe(2)
  })

  it('getError non-zero emits plugin.webgl.error immediately', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    gl.getError.mockReturnValueOnce(0x0500)
    const proxied = plugin.track(gl as never)
    proxied.drawArrays(4, 0, 3)
    const errorCall = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.error')
    expect(errorCall).toBeDefined()
    expect(errorCall![0].data.error).toBe('INVALID_ENUM')
    expect(errorCall![0].data.canvas).toBe('my-canvas')
  })

  it('GL error is also accumulated into next frame glErrors', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    gl.getError.mockReturnValueOnce(0x0502)
    const proxied = plugin.track(gl as never)
    proxied.drawArrays(4, 0, 3)
    plugin.frame()
    const frameCall = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.frame')!
    expect(frameCall[0].data.glErrors).toContain('INVALID_OPERATION')
  })

  it('canvas with no id uses canvas[N] format', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    ;(gl.canvas as unknown as { id: string }).id = ''
    gl.getError.mockReturnValueOnce(0x0500)
    const proxied = plugin.track(gl as never)
    proxied.drawArrays(4, 0, 3)
    const errorCall = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.error')!
    expect(errorCall[0].data.canvas).toBe('canvas[0]')
  })

  it('browser.snapshot() returns lightweight summary', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    plugin.track(mockGl() as never)
    const snap = plugin.browser!.snapshot()
    expect(snap).toEqual({ contextCount: 1, totalFrames: 0, lastFrame: null })
  })

  it('drawElements also accumulates drawCalls and primitiveCount', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    const proxied = plugin.track(gl as never)
    proxied.drawElements(4, 6, 0x1405, 0)
    plugin.frame()
    const call = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.frame')!
    expect(call[0].data.drawCalls).toBe(1)
    expect(call[0].data.primitiveCount).toBe(6)
  })

  it('browser.snapshot().lastFrame is populated after frame()', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    const proxied = plugin.track(gl as never)
    proxied.drawArrays(4, 0, 9)
    plugin.frame()
    const snap = plugin.browser!.snapshot()
    expect(snap.lastFrame).toEqual({ drawCalls: 1, glErrors: [], primitiveCount: 9 })
    expect(snap.totalFrames).toBe(1)
  })

  it('calls before setup() are silently dropped', () => {
    const plugin = createWebGLPlugin()
    expect(() => plugin.frame()).not.toThrow()
    expect(() => plugin.stateSnapshot()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/plugin-webgl && pnpm test
```

Expected: failures (createWebGLPlugin throws "not implemented")

- [ ] **Step 3: Implement `packages/plugin-webgl/src/index.ts`**

```ts
import type { IntrospectionPlugin, BrowserAgent } from '@introspection/types'

export interface WebGLPlugin extends IntrospectionPlugin {
  track<T extends WebGLRenderingContext | WebGL2RenderingContext>(gl: T): T
  frame(): void
  stateSnapshot(): void
}

type AnyGL = WebGLRenderingContext | WebGL2RenderingContext

interface ShaderInfo { type: number; source: string; compiled: boolean; log: string }
interface ProgramInfo {
  linked: boolean; log: string
  uniforms: Array<{ name: string; type: string; value: unknown }>
  attributes: Array<{ name: string; location: number }>
}
interface TextureInfo { width: number; height: number; format: number; internalFormat: number }
interface FrameStats { drawCalls: number; glErrors: string[]; primitiveCount: number }

const GL_ERRORS: Record<number, string> = {
  0x0500: 'INVALID_ENUM',
  0x0501: 'INVALID_VALUE',
  0x0502: 'INVALID_OPERATION',
  0x0505: 'OUT_OF_MEMORY',
  0x0506: 'INVALID_FRAMEBUFFER_OPERATION',
}

function canvasId(canvas: HTMLCanvasElement | OffscreenCanvas | null | undefined, index: number): string {
  if (canvas && 'id' in canvas && (canvas as HTMLCanvasElement).id) return (canvas as HTMLCanvasElement).id
  return `canvas[${index}]`
}

export function createWebGLPlugin(): WebGLPlugin {
  let agent: BrowserAgent | null = null

  const shaders = new Map<object, ShaderInfo>()
  const programs = new Map<object, ProgramInfo>()
  const textures = new Map<object, TextureInfo>()
  const contexts = new Map<AnyGL, HTMLCanvasElement | OffscreenCanvas | null>()

  // Maps GL target enum → currently bound texture object (updated by bindTexture interception)
  const currentTexture = new Map<number, object>()

  let acc: FrameStats = { drawCalls: 0, glErrors: [], primitiveCount: 0 }
  let totalFrames = 0
  let lastFrame: FrameStats | null = null

  function emit(type: `plugin.${string}`, data: Record<string, unknown>) {
    agent?.emit({ type, data })
  }

  function ctxIndex(gl: AnyGL) { return [...contexts.keys()].indexOf(gl) }

  function handleDraw(gl: AnyGL, count: number) {
    acc.drawCalls++
    acc.primitiveCount += count
    const code = (gl as WebGLRenderingContext).getError()
    if (code !== 0) {
      const name = GL_ERRORS[code] ?? `0x${code.toString(16)}`
      const canvas = contexts.get(gl) ?? (gl as WebGLRenderingContext).canvas ?? null
      emit('plugin.webgl.error', { error: name, canvas: canvasId(canvas as HTMLCanvasElement | null, ctxIndex(gl)) })
      acc.glErrors.push(name)
    }
  }

  function wrap<T extends AnyGL>(gl: T): T {
    return new Proxy(gl, {
      get(target, prop, receiver) {
        const val = Reflect.get(target, prop, receiver)
        if (typeof val !== 'function') return val

        if (prop === 'shaderSource') return (shader: object, source: string) => {
          if (!shaders.has(shader)) shaders.set(shader, { type: 0, source: '', compiled: false, log: '' })
          shaders.get(shader)!.source = source
          return val.call(target, shader, source)
        }

        if (prop === 'compileShader') return (shader: object) => {
          const r = val.call(target, shader)
          if (!shaders.has(shader)) shaders.set(shader, { type: 0, source: '', compiled: false, log: '' })
          const info = shaders.get(shader)!
          info.compiled = !!(gl as WebGLRenderingContext).getShaderParameter(shader as WebGLShader, (gl as WebGLRenderingContext).COMPILE_STATUS)
          info.log = (gl as WebGLRenderingContext).getShaderInfoLog(shader as WebGLShader) ?? ''
          return r
        }

        if (prop === 'linkProgram') return (program: object) => {
          const r = val.call(target, program)
          const g = gl as WebGLRenderingContext
          const uniformCount = g.getProgramParameter(program as WebGLProgram, g.ACTIVE_UNIFORMS) as number
          const attrCount = g.getProgramParameter(program as WebGLProgram, g.ACTIVE_ATTRIBUTES) as number
          const uniforms: ProgramInfo['uniforms'] = []
          const attributes: ProgramInfo['attributes'] = []
          for (let i = 0; i < uniformCount; i++) {
            const u = g.getActiveUniform(program as WebGLProgram, i)
            if (u) uniforms.push({ name: u.name, type: String(u.type), value: null })
          }
          for (let i = 0; i < attrCount; i++) {
            const a = g.getActiveAttrib(program as WebGLProgram, i)
            if (a) attributes.push({ name: a.name, location: i })
          }
          programs.set(program, {
            linked: !!g.getProgramParameter(program as WebGLProgram, g.LINK_STATUS),
            log: g.getProgramInfoLog(program as WebGLProgram) ?? '',
            uniforms, attributes,
          })
          return r
        }

        if (prop === 'bindTexture') return (texTarget: number, texture: object | null) => {
          if (texture) currentTexture.set(texTarget, texture)
          else currentTexture.delete(texTarget)
          return val.call(target, texTarget, texture)
        }

        if (prop === 'texImage2D') return (...args: unknown[]) => {
          const texTarget = args[0] as number
          const texture = currentTexture.get(texTarget)
          if (texture) {
            // texImage2D(target, level, internalFormat, width, height, border, format, type, pixels) — 9 args
            // texImage2D(target, level, internalFormat, format, type, source) — 6 args
            const internalFormat = args[2] as number
            const format = args.length >= 9 ? args[6] as number : args[3] as number
            const width = args.length >= 9 ? args[3] as number : 0
            const height = args.length >= 9 ? args[4] as number : 0
            textures.set(texture, { width, height, format, internalFormat })
          }
          return (val as (...a: unknown[]) => unknown).apply(target, args)
        }

        if (prop === 'texImage3D') return (...args: unknown[]) => {
          // texImage3D(target, level, internalFormat, width, height, depth, border, format, type, pixels)
          const texTarget = args[0] as number
          const texture = currentTexture.get(texTarget)
          if (texture) {
            const internalFormat = args[2] as number
            const format = args[7] as number
            const width = args[3] as number
            const height = args[4] as number
            textures.set(texture, { width, height, format, internalFormat })
          }
          return (val as (...a: unknown[]) => unknown).apply(target, args)
        }

        if (prop === 'drawArrays' || prop === 'drawElements' ||
            prop === 'drawArraysInstanced' || prop === 'drawElementsInstanced') {
          return (...args: unknown[]) => {
            const r = (val as (...a: unknown[]) => unknown).apply(target, args)
            handleDraw(gl, args[2] as number)
            return r
          }
        }

        return val.bind(target)
      },
    })
  }

  const plugin: WebGLPlugin = {
    name: 'webgl',

    browser: {
      setup(a) { agent = a },
      snapshot() {
        return { contextCount: contexts.size, totalFrames, lastFrame }
      },
    },

    track<T extends AnyGL>(gl: T): T {
      const canvas = (gl as WebGLRenderingContext).canvas ?? null
      contexts.set(gl, canvas as HTMLCanvasElement | OffscreenCanvas | null)
      if (canvas && 'addEventListener' in canvas) {
        const idx = ctxIndex(gl)
        ;(canvas as HTMLCanvasElement).addEventListener('webglcontextlost', () => {
          emit('plugin.webgl.contextlost', { canvas: canvasId(canvas as HTMLCanvasElement, idx) })
          plugin.stateSnapshot()
        })
      }
      return wrap(gl)
    },

    frame() {
      const stats = { ...acc, contextCount: contexts.size }
      lastFrame = { drawCalls: acc.drawCalls, glErrors: acc.glErrors, primitiveCount: acc.primitiveCount }
      totalFrames++
      acc = { drawCalls: 0, glErrors: [], primitiveCount: 0 }
      emit('plugin.webgl.frame', stats)
    },

    stateSnapshot() {
      emit('plugin.webgl.stateSnapshot', {
        shaders: [...shaders.values()].map(s => ({
          type: s.type === 0x8B31 ? 'VERTEX_SHADER' : 'FRAGMENT_SHADER',
          source: s.source, compiled: s.compiled, log: s.log,
        })),
        programs: [...programs.values()],
        textures: [...textures.values()].map(t => ({
          width: t.width, height: t.height,
          format: String(t.format), internalFormat: String(t.internalFormat),
        })),
        frames: { total: totalFrames, last: lastFrame },
      })
    },
  }

  return plugin
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/plugin-webgl && pnpm test
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-webgl/src/index.ts packages/plugin-webgl/test/plugin-webgl.test.ts
git commit -m "feat(plugin-webgl): track(), frame() — draw call interception, error detection"
```

---

## Task 3: Shader, program, texture tracking + `stateSnapshot()`

**Files:**
- Modify: `packages/plugin-webgl/test/plugin-webgl.test.ts`

The implementation already has the shader/program/texture tracking wired in from Task 2. This task adds the tests that verify it and covers `stateSnapshot()` and the context-loss handler.

- [ ] **Step 1: Write failing tests**

Add to `packages/plugin-webgl/test/plugin-webgl.test.ts`:

```ts
  it('compileShader failure is recorded in shader registry', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    gl.getShaderParameter.mockReturnValue(false)
    gl.getShaderInfoLog.mockReturnValue('syntax error')
    const proxied = plugin.track(gl as never)
    const shader = {}
    proxied.shaderSource(shader as never, 'void main() {}')
    proxied.compileShader(shader as never)
    plugin.stateSnapshot()
    const call = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.stateSnapshot')!
    expect(call[0].data.shaders[0].compiled).toBe(false)
    expect(call[0].data.shaders[0].log).toBe('syntax error')
    expect(call[0].data.shaders[0].source).toBe('void main() {}')
  })

  it('stateSnapshot() emits frames.total and frames.last', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    const proxied = plugin.track(gl as never)
    proxied.drawArrays(4, 0, 3)
    plugin.frame()
    plugin.stateSnapshot()
    const call = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.stateSnapshot')!
    expect(call[0].data.frames.total).toBe(1)
    expect(call[0].data.frames.last.drawCalls).toBe(1)
  })

  it('bindTexture + texImage2D records texture info keyed by texture object', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    const proxied = plugin.track(gl as never)
    const tex = {}
    proxied.bindTexture(0xDE1 /* TEXTURE_2D */, tex as never)
    proxied.texImage2D(0xDE1, 0, 0x1908 /* RGBA */, 64, 32, 0, 0x1908, 0x1401, null)
    plugin.stateSnapshot()
    const call = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.stateSnapshot')!
    expect(call[0].data.textures[0].width).toBe(64)
    expect(call[0].data.textures[0].height).toBe(32)
  })

  it('webglcontextlost emits plugin.webgl.contextlost and triggers stateSnapshot', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    let lostHandler: (() => void) | undefined
    ;(gl.canvas as unknown as { addEventListener: (e: string, fn: () => void) => void }).addEventListener = (_e: string, fn: () => void) => { lostHandler = fn }
    plugin.track(gl as never)
    lostHandler!()
    const lostCall = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.contextlost')
    const snapCall = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.stateSnapshot')
    expect(lostCall).toBeDefined()
    expect(snapCall).toBeDefined()
  })
```

- [ ] **Step 2: Run all tests — most should pass immediately**

The implementation from Task 2 already covers shader/program/texture tracking and context-loss. Run to confirm:

```bash
cd packages/plugin-webgl && pnpm test
```

Expected: all tests pass. If any fail, fix the implementation before committing.

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-webgl/test/plugin-webgl.test.ts
git commit -m "test(plugin-webgl): shader/program tracking, stateSnapshot, context-loss tests"
```

---

## Task 4: Final integration check

- [ ] **Step 1: Run all package tests**

```bash
pnpm --filter '@introspection/*' test
```

Expected: all tests pass across all packages

- [ ] **Step 2: TypeScript check**

```bash
pnpm --filter '@introspection/*' exec tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit any minor fixes if needed**

---

## Reference: Spec

Full spec: `docs/superpowers/specs/2026-04-02-webgl-plugin-design.md`

Key constants:
- GL error codes: `0x0500` INVALID_ENUM, `0x0501` INVALID_VALUE, `0x0502` INVALID_OPERATION, `0x0505` OUT_OF_MEMORY, `0x0506` INVALID_FRAMEBUFFER_OPERATION
- `canvas` field: canvas `id` attribute if present, else `canvas[N]` (0-based index in contexts map)
- `primitiveCount`: raw `count` argument (not topology-adjusted)
- Calls before `browser.setup()`: silently dropped (no throw)
- No server-side changes
