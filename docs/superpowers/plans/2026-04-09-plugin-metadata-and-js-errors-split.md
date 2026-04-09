# Plugin Metadata & jsErrors Event Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plugins declare metadata (description, events, options) recorded in meta.json; jsErrors emits two separate events from Runtime.exceptionThrown and Debugger.paused.

**Architecture:** Extend `IntrospectionPlugin` with optional metadata fields. `attach()` extracts metadata and passes it to `initSessionDir()` which writes it into `meta.json`. The jsErrors plugin adds a `Runtime.exceptionThrown` listener emitting `js.error` and changes the existing `Debugger.paused` listener to emit `js.error.paused`. A new CLI `plugins` command reads metadata from `meta.json`.

**Tech Stack:** TypeScript, vitest, Playwright (for integration tests)

**Spec:** `docs/superpowers/specs/2026-04-09-plugin-metadata-and-js-errors-split-design.md`

---

### Task 1: Extend types — plugin metadata and new event type

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Add `PluginMeta` type and `plugins` to `SessionMeta`**

After line 191 (`label?: string`), add:

```ts
  plugins?: PluginMeta[]
```

After the `SessionMeta` interface (after line 192), add:

```ts
export interface PluginMeta {
  name: string
  description?: string
  events?: Record<string, string>
  options?: Record<string, { description: string; value: unknown }>
}
```

- [ ] **Step 2: Add metadata fields to `IntrospectionPlugin`**

In the `IntrospectionPlugin` interface (line 144), add after `name: string`:

```ts
  description?: string
  events?: Record<string, string>
  options?: Record<string, { description: string; value: unknown }>
```

- [ ] **Step 3: Add `JsErrorPausedEvent` and update `TraceEvent` union**

After `JsErrorEvent` (line 38), add:

```ts
export interface JsErrorPausedEvent extends BaseEvent {
  type: 'js.error.paused'
  data: { message: string; stack: StackFrame[] }
}
```

Add `JsErrorPausedEvent` to the `TraceEvent` union (before `PluginEvent`):

```ts
  | JsErrorPausedEvent
```

- [ ] **Step 4: Update `Snapshot['trigger']` union**

Change line 177 from:

```ts
  trigger: 'js.error' | 'manual'
```

to:

```ts
  trigger: 'js.error' | 'js.error.paused' | 'manual'
```

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "types: add plugin metadata, JsErrorPausedEvent, and PluginMeta"
```

---

### Task 2: Update session writer to accept plugin metadata

**Files:**
- Modify: `packages/core/src/session-writer.ts`
- Test: `packages/core/test/session-writer.test.ts`

- [ ] **Step 1: Write test for plugin metadata in meta.json**

Add to `packages/core/test/session-writer.test.ts` inside the `initSessionDir` describe block:

```ts
  it('writes plugin metadata to meta.json when provided', async () => {
    await initSessionDir(dir, {
      ...initParams,
      plugins: [
        {
          name: 'js-errors',
          description: 'Captures errors',
          events: { 'js.error': 'Uncaught exception' },
          options: { pauseOnExceptions: { description: 'Pause mode', value: 'uncaught' } },
        },
      ],
    })
    const meta = JSON.parse(await readFile(join(dir, 'sess-1', 'meta.json'), 'utf-8'))
    expect(meta.plugins).toHaveLength(1)
    expect(meta.plugins[0].name).toBe('js-errors')
    expect(meta.plugins[0].events['js.error']).toBe('Uncaught exception')
    expect(meta.plugins[0].options.pauseOnExceptions.value).toBe('uncaught')
  })

  it('omits plugins from meta.json when not provided', async () => {
    await initSessionDir(dir, initParams)
    const meta = JSON.parse(await readFile(join(dir, 'sess-1', 'meta.json'), 'utf-8'))
    expect(meta.plugins).toBeUndefined()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/puckey/rg/introspection && pnpm -F @introspection/core test`
Expected: FAIL — `plugins` property not written

- [ ] **Step 3: Update `SessionInitParams` and `initSessionDir`**

In `packages/core/src/session-writer.ts`, add to `SessionInitParams` (line 6-10):

```ts
export interface SessionInitParams {
  id: string
  startedAt: number
  label?: string
  plugins?: PluginMeta[]
}
```

Add the import at line 4:

```ts
import type { TraceEvent, SessionMeta, BodySummary, EventSource, PluginMeta } from '@introspection/types'
```

Update `initSessionDir` (line 43) to include plugins:

```ts
  const meta: SessionMeta = {
    version: '2',
    id: parameters.id,
    startedAt: parameters.startedAt,
    label: parameters.label,
    plugins: parameters.plugins,
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/puckey/rg/introspection && pnpm -F @introspection/core test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session-writer.ts packages/core/test/session-writer.test.ts
git commit -m "core: write plugin metadata to meta.json"
```

---

### Task 3: Pass plugin metadata from attach() to initSessionDir

**Files:**
- Modify: `packages/playwright/src/attach.ts`

- [ ] **Step 1: Extract plugin metadata and pass to initSessionDir**

In `packages/playwright/src/attach.ts`, add an import for `PluginMeta` at line 3:

```ts
import type { TraceEvent, IntrospectHandle, DetachResult, IntrospectionPlugin, PluginContext, PluginMeta } from '@introspection/types'
```

Before the `initSessionDir` call (line 27), extract metadata from plugins:

```ts
  const pluginMetas: PluginMeta[] = opts.plugins
    .map(({ name, description, events, options }) => {
      const meta: PluginMeta = { name }
      if (description) meta.description = description
      if (events) meta.events = events
      if (options) meta.options = options
      return meta
    })
```

Update the `initSessionDir` call (line 27):

```ts
  await initSessionDir(outDir, { id: sessionId, startedAt, label: testTitle, plugins: pluginMetas.length > 0 ? pluginMetas : undefined })
```

- [ ] **Step 2: Commit**

```bash
git add packages/playwright/src/attach.ts
git commit -m "playwright: pass plugin metadata to initSessionDir"
```

---

### Task 4: Split jsErrors plugin into two events

**Files:**
- Modify: `packages/plugin-js-errors/src/index.ts`
- Test: `packages/playwright/test/attach.spec.ts` (existing integration test at line 78 covers `js.error`; add test for `js.error.paused`)

- [ ] **Step 1: Add plugin metadata fields**

Update the return object in the `jsErrors` function to include metadata:

```ts
  return {
    name: 'js-errors',
    description: 'Captures uncaught exceptions and unhandled rejections with scope locals and DOM snapshots',
    events: {
      'js.error': 'Uncaught exception or unhandled rejection',
      'js.error.paused': 'Debugger paused on exception — includes scope locals from call stack',
    },
    options: {
      pauseOnExceptions: {
        description: 'Whether to pause on "all" exceptions or only "uncaught" ones',
        value: pauseState,
      },
    },

    async install(ctx: PluginContext): Promise<void> {
```

- [ ] **Step 2: Add `Runtime.exceptionThrown` handler**

Add after the `Debugger.setPauseOnExceptions` call, before the `Debugger.paused` handler:

```ts
      ctx.cdpSession.on('Runtime.exceptionThrown', (rawParams) => {
        const parameters = rawParams as { exceptionDetails: Record<string, unknown> }

        void (async () => {
          const errorEvent = normaliseCdpJsError(
            { exceptionDetails: parameters.exceptionDetails, timestamp: Date.now() / 1000 } as Record<string, unknown>,
            0,
          )
          ctx.emit(errorEvent)

          const url = await ctx.cdpSession.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true })
            .then((r) => ((r as { result: { value?: string } }).result.value ?? ''))
            .catch(() => '')

          const snapshot = await takeSnapshot({
            cdpSession: { send: (method, params) => ctx.cdpSession.send(method, params) },
            trigger: 'js.error',
            url,
            callFrames: [],
          })

          await ctx.writeAsset({
            kind: 'snapshot',
            content: JSON.stringify(snapshot),
            metadata: {
              timestamp: ctx.timestamp(),
              trigger: 'js.error',
              url: snapshot.url,
              scopeCount: 0,
            },
          })

          await ctx.bus.emit('js.error', {
            trigger: 'js.error',
            timestamp: ctx.timestamp(),
            message: String(errorEvent.data.message ?? ''),
          })
        })()
      })
```

- [ ] **Step 3: Update `Debugger.paused` handler to emit `js.error.paused`**

In the existing `Debugger.paused` handler, change the `normaliseCdpJsError` call result to emit as `js.error.paused`. Replace the line (around line 88):

```ts
          const errorEvent = normaliseCdpJsError(syntheticParams as Record<string, unknown>, 0)
          ctx.emit(errorEvent)
```

with:

```ts
          const errorEvent = normaliseCdpJsError(syntheticParams as Record<string, unknown>, 0)
          ctx.emit({ ...errorEvent, type: 'js.error.paused' })
```

Update the snapshot trigger from `'js.error'` to `'js.error.paused'`:

```ts
          const snapshot = await takeSnapshot({
            cdpSession: { send: (method, params) => ctx.cdpSession.send(method, params) },
            trigger: 'js.error.paused',
            url,
            callFrames: [],
          })
          const mergedSnapshot = { ...snapshot, scopes }

          await ctx.writeAsset({
            kind: 'snapshot',
            content: JSON.stringify(mergedSnapshot),
            metadata: {
              timestamp: ctx.timestamp(),
              trigger: 'js.error.paused',
              url: mergedSnapshot.url,
              scopeCount: mergedSnapshot.scopes.length,
            },
          })
```

Remove the `bus.emit('js.error', ...)` call from the `Debugger.paused` handler — only `Runtime.exceptionThrown` emits the bus event now.

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-js-errors/src/index.ts
git commit -m "plugin-js-errors: split into js.error (Runtime) and js.error.paused (Debugger)"
```

---

### Task 5: Add metadata to network and webgl plugins

**Files:**
- Modify: `packages/plugin-network/src/index.ts`
- Modify: `packages/plugin-webgl/src/index.ts`

- [ ] **Step 1: Add metadata to network plugin**

In `packages/plugin-network/src/index.ts`, update the returned object to include metadata:

```ts
  return {
    name: 'network',
    description: 'Captures HTTP requests, responses, and response bodies',
    events: {
      'network.request': 'Outgoing HTTP request',
      'network.response': 'HTTP response with optional body summary',
      'network.error': 'Failed or aborted request',
    },

    async install(ctx: PluginContext): Promise<void> {
```

- [ ] **Step 2: Add metadata to webgl plugin**

In `packages/plugin-webgl/src/index.ts`, update the returned object to include metadata:

```ts
  return {
    name: 'webgl',
    description: 'Captures WebGL state, uniforms, draw calls, textures, and canvas PNGs',
    events: {
      'webgl.context-created': 'New WebGL rendering context',
      'webgl.uniform': 'Uniform variable update',
      'webgl.draw-arrays': 'drawArrays call',
      'webgl.texture-bind': 'Texture bind to a texture unit',
    },

    async install(ctx: PluginContext): Promise<void> {
```

- [ ] **Step 3: Commit**

```bash
git add packages/plugin-network/src/index.ts packages/plugin-webgl/src/index.ts
git commit -m "plugins: add metadata to network and webgl plugins"
```

---

### Task 6: Add CLI `plugins` command

**Files:**
- Create: `packages/cli/src/commands/plugins.ts`
- Modify: `packages/cli/src/index.ts`
- Create: `packages/cli/test/commands/plugins.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/cli/test/commands/plugins.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatPlugins } from '../../src/commands/plugins.js'
import type { SessionMeta } from '@introspection/types'

describe('formatPlugins', () => {
  it('formats plugin metadata with events and options', () => {
    const session: SessionMeta = {
      version: '2',
      id: 'sess-1',
      startedAt: 1000,
      label: 'my test',
      plugins: [
        {
          name: 'js-errors',
          description: 'Captures errors',
          events: { 'js.error': 'Uncaught exception', 'js.error.paused': 'Debugger paused' },
          options: { pauseOnExceptions: { description: 'Pause mode', value: 'uncaught' } },
        },
        {
          name: 'network',
          description: 'Captures HTTP',
          events: { 'network.request': 'Outgoing request' },
        },
      ],
    }
    const out = formatPlugins(session)
    expect(out).toContain('js-errors')
    expect(out).toContain('Captures errors')
    expect(out).toContain('js.error')
    expect(out).toContain('Uncaught exception')
    expect(out).toContain('js.error.paused')
    expect(out).toContain('pauseOnExceptions')
    expect(out).toContain('"uncaught"')
    expect(out).toContain('Pause mode')
    expect(out).toContain('network')
    expect(out).toContain('Captures HTTP')
  })

  it('returns message when no plugins metadata', () => {
    const session: SessionMeta = { version: '2', id: 'sess-1', startedAt: 1000 }
    const out = formatPlugins(session)
    expect(out).toContain('No plugin metadata')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/puckey/rg/introspection && pnpm -F introspect test`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `formatPlugins`**

Create `packages/cli/src/commands/plugins.ts`:

```ts
import type { SessionMeta } from '@introspection/types'

export function formatPlugins(session: SessionMeta): string {
  if (!session.plugins?.length) {
    return '(No plugin metadata recorded in this session)'
  }

  const sections: string[] = []

  for (const plugin of session.plugins) {
    const lines: string[] = []
    const header = plugin.description
      ? `${plugin.name} — ${plugin.description}`
      : plugin.name
    lines.push(header)

    if (plugin.events) {
      lines.push('  Events:')
      const maxLen = Math.max(...Object.keys(plugin.events).map(k => k.length))
      for (const [type, description] of Object.entries(plugin.events)) {
        lines.push(`    ${type.padEnd(maxLen + 2)}${description}`)
      }
    }

    if (plugin.options) {
      lines.push('  Options:')
      for (const [key, { description, value }] of Object.entries(plugin.options)) {
        lines.push(`    ${key} = ${JSON.stringify(value)}  ${description}`)
      }
    }

    sections.push(lines.join('\n'))
  }

  return sections.join('\n\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/puckey/rg/introspection && pnpm -F introspect test`
Expected: PASS

- [ ] **Step 5: Wire up the CLI command**

In `packages/cli/src/index.ts`, add the import (after line 11):

```ts
import { formatPlugins } from './commands/plugins.js'
```

Add the command (after the `list` command, before `skillsCmd`):

```ts
program.command('plugins').description('Show plugin metadata for a session').option('--session <id>').action(async (opts) => {
  const trace = await loadTrace(opts)
  const session = { ...trace.session, version: '2' as const }
  console.log(formatPlugins(session))
})
```

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/plugins.ts packages/cli/src/index.ts packages/cli/test/commands/plugins.test.ts
git commit -m "cli: add plugins command to show plugin metadata"
```

---

### Task 7: Build and verify end-to-end

**Files:** (no new files)

- [ ] **Step 1: Build all packages**

```bash
cd /Users/puckey/rg/introspection && pnpm -r build
```

- [ ] **Step 2: Run all unit tests**

```bash
cd /Users/puckey/rg/introspection && pnpm -F @introspection/core test && pnpm -F introspect test
```

- [ ] **Step 3: Run playwright integration tests (if they pass currently)**

```bash
cd /Users/puckey/rg/introspection && pnpm -F @introspection/playwright test
```

- [ ] **Step 4: Commit any fixes**

If any tests needed adjustments, commit them.
