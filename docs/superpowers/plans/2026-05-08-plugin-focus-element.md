# `@introspection/plugin-focus-element` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a plugin that emits `focus.changed` events for every focus transition during a Playwright session — covering shadow DOM, same-origin iframes, programmatic vs unknown causes (with stack trace for programmatic calls), and a per-plugin `origins` filter.

**Architecture:** Browser-side script injected via Playwright's `addInitScript` (no CDP). Listens to `focusin` on `document` (with a narrow `focusout` fallback for "focus leaves document"), walks `activeElement` through shadow roots, patches `HTMLElement.prototype.focus`/`.blur` to capture programmatic call sites synchronously. Each frame instance emits independently and tags sub-frame events with `origin: location.origin`. Built as IIFE via `tsup` (mirrors `plugin-performance`).

**Tech Stack:** TypeScript, Playwright, `tsup` (dual ESM + IIFE build), `@introspection/types`, `@introspection/utils` (`createDebug`).

**Spec:** `docs/superpowers/specs/2026-05-08-plugin-focus-element-design.md`

---

## File Structure

| Path | Responsibility |
|---|---|
| `plugins/plugin-focus-element/package.json` | Workspace package manifest (mirrors `plugin-performance`) |
| `plugins/plugin-focus-element/tsconfig.json` | TS config; excludes `src/browser.ts` from Node build |
| `plugins/plugin-focus-element/tsup.browser.config.ts` | IIFE build for `browser.ts` → `dist/browser.iife.js` |
| `plugins/plugin-focus-element/tsup.node.config.ts` | ESM build for `index.ts` → `dist/index.js`; loads `.iife.js` as text |
| `plugins/plugin-focus-element/playwright.config.ts` | Playwright runner config |
| `plugins/plugin-focus-element/src/iife.d.ts` | Module declaration for `*.iife.js` text imports |
| `plugins/plugin-focus-element/src/index.ts` | `focusElement()` factory; embeds the IIFE + config into `plugin.script` |
| `plugins/plugin-focus-element/src/browser.ts` | Browser-side IIFE: focus listeners, `.focus()` patch, `ElementInfo` builder, origin gate |
| `plugins/plugin-focus-element/test/focus.spec.ts` | Playwright end-to-end tests (single file; the spec calls out 7 scenarios) |
| `plugins/plugin-focus-element/test/fixtures/*.html` | Static HTML fixtures referenced by tests |
| `plugins/plugin-focus-element/README.md` | Install, usage, event table, options, caveats |
| `packages/types/src/index.ts` (modify) | Add `FocusChangedEvent`, `FocusCause`, `ElementInfo`; register `'focus.changed'` in `TraceEventMap` |

`browser.ts` is one file. It will grow but stays focused (one responsibility: capture focus changes). If it crosses ~300 lines, split out the `ElementInfo` builder; until then, keep it together — easier to reason about a single IIFE.

---

## Task 1: Scaffold the package

**Files:**
- Create: `plugins/plugin-focus-element/package.json`
- Create: `plugins/plugin-focus-element/tsconfig.json`
- Create: `plugins/plugin-focus-element/tsup.browser.config.ts`
- Create: `plugins/plugin-focus-element/tsup.node.config.ts`
- Create: `plugins/plugin-focus-element/playwright.config.ts`
- Create: `plugins/plugin-focus-element/src/iife.d.ts`
- Create: `plugins/plugin-focus-element/src/browser.ts` (stub)
- Create: `plugins/plugin-focus-element/src/index.ts` (stub)

- [ ] **Step 1.1: Write `package.json`**

```json
{
  "name": "@introspection/plugin-focus-element",
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
    "test": "playwright test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@introspection/types": "workspace:*",
    "@introspection/utils": "workspace:*"
  },
  "devDependencies": {
    "@introspection/playwright": "workspace:*",
    "@playwright/test": "^1.40.0",
    "tsup": "^8.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 1.2: Write `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist"
  },
  "include": ["src", "test"],
  "exclude": ["src/browser.ts"]
}
```

- [ ] **Step 1.3: Write `tsup.browser.config.ts`**

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { browser: 'src/browser.ts' },
  outDir: 'dist',
  format: ['iife'],
  globalName: '__introspect_focus_browser__',
  platform: 'browser',
  minify: false,
  outExtension: () => ({ js: '.iife.js' }),
  noExternal: [/.*/],
})
```

- [ ] **Step 1.4: Write `tsup.node.config.ts`**

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  dts: true,
  esbuildOptions(options) {
    options.loader = { ...options.loader, '.iife.js': 'text' }
  },
})
```

- [ ] **Step 1.5: Write `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  use: { headless: true },
})
```

- [ ] **Step 1.6: Write `src/iife.d.ts`**

```ts
declare module '*.iife.js' {
  const content: string
  export default content
}
```

- [ ] **Step 1.7: Write a stub `src/browser.ts`**

Stub content (real implementation follows in later tasks):

```ts
;(() => {
  // populated incrementally
})()
```

- [ ] **Step 1.8: Write a stub `src/index.ts`**

```ts
import BROWSER_SCRIPT from '../dist/browser.iife.js'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import { createDebug } from '@introspection/utils'

export interface FocusElementOptions {
  origins?: (string | RegExp)[]
  verbose?: boolean
}

export function focusElement(options?: FocusElementOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-focus-element', options?.verbose ?? false)
  const originsConfig = serialiseOrigins(options?.origins)
  return {
    name: 'focus-element',
    description: 'Captures every focus transition (shadow DOM, iframes, programmatic call sites)',
    events: {
      'focus.changed': 'Focus moved between elements (or left/entered the document)',
    },
    script: `var __introspect_focus_config__=${originsConfig};${BROWSER_SCRIPT}`,
    async install(_context: PluginContext): Promise<void> {
      debug('installing', { origins: options?.origins ?? null })
    },
  }
}

function serialiseOrigins(origins: (string | RegExp)[] | undefined): string {
  if (!origins) return 'null'
  const entries = origins.map((entry) =>
    entry instanceof RegExp
      ? `{ kind: 'regex', source: ${JSON.stringify(entry.source)}, flags: ${JSON.stringify(entry.flags)} }`
      : `{ kind: 'string', value: ${JSON.stringify(entry)} }`
  )
  return `[${entries.join(',')}]`
}
```

`RegExp`s can't survive `JSON.stringify`, so we serialise to a tagged-union literal that the browser script reconstructs. The `null` sentinel means "match all".

- [ ] **Step 1.9: Install workspace deps and verify the package builds**

Run:
```bash
pnpm install
pnpm -C plugins/plugin-focus-element build
```
Expected: `dist/browser.iife.js` and `dist/index.js` exist, no TypeScript errors.

- [ ] **Step 1.10: Commit**

```bash
git add plugins/plugin-focus-element pnpm-lock.yaml
git commit -m "plugin-focus-element: scaffold package"
```

---

## Task 2: Register `FocusChangedEvent` in central types

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 2.1: Add interfaces near the other plugin event types**

Locate the section after the `Console` event (around line 130-140) and add:

```ts
// Focus
export interface ElementInfo {
  tag: string
  id: string | null
  classList: string[]
  testid: string | null
  role: string | null
  accessibleName: string | null
  text: string | null
  selector: string
  shadowPath: string[] | null
  backendNodeId: number | null
}

export type FocusCause =
  | { cause: 'programmatic'; callSite: string }
  | { cause: 'unknown' }

export type FocusChangedEvent = BaseEvent & {
  type: 'focus.changed'
  metadata: {
    target: ElementInfo | null
    previous: ElementInfo | null
    origin?: string
  } & FocusCause
}
```

`BaseEvent & { ... }` is needed instead of `extends BaseEvent` because the metadata uses an intersection with the discriminated union — `interface extends` collapses unions otherwise.

- [ ] **Step 2.2: Register in `TraceEventMap`**

In the `TraceEventMap` interface (around line 399), add a new line in alphabetical-ish order with the other plugin events (after `'console'`):

```ts
  // Focus
  'focus.changed': FocusChangedEvent
```

- [ ] **Step 2.3: Typecheck the types package**

Run:
```bash
pnpm -C packages/types build
```
Expected: succeeds, no TS errors.

- [ ] **Step 2.4: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "types: add FocusChangedEvent for plugin-focus-element"
```

---

## Task 3: First failing test — initial focus snapshot

**Files:**
- Create: `plugins/plugin-focus-element/test/fixtures/simple.html`
- Create: `plugins/plugin-focus-element/test/focus.spec.ts`

- [ ] **Step 3.1: Write `test/fixtures/simple.html`**

```html
<!doctype html>
<html>
<body>
  <input id="alpha" data-testid="alpha-input" aria-label="Alpha" />
  <input id="beta" data-testid="beta-input" aria-label="Beta" autofocus />
  <button id="go" data-testid="go-btn">Go</button>
</body>
</html>
```

- [ ] **Step 3.2: Write `test/focus.spec.ts` with the test harness and one test**

```ts
import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { attach } from '@introspection/playwright'
import { focusElement } from '../dist/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

let outDir: string

test.beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'introspect-focus-'))
})

test.afterEach(async () => {
  await rm(outDir, { recursive: true, force: true })
})

async function readEvents(outDirectory: string): Promise<Array<Record<string, unknown>>> {
  const entries = await readdir(outDirectory)
  const ndjson = await readFile(join(outDirectory, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

async function gotoFixture(page: import('@playwright/test').Page, name: string) {
  await page.goto('file://' + join(HERE, 'fixtures', name))
}

test('emits initial focus snapshot for autofocused element', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [focusElement()] })
  await gotoFixture(page, 'simple.html')
  await page.waitForFunction(() => document.activeElement?.id === 'beta')
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const focusEvents = events.filter((e) => e.type === 'focus.changed')
  expect(focusEvents.length).toBeGreaterThanOrEqual(1)
  const initial = focusEvents[0] as { metadata: { previous: unknown; target: { id: string }; cause: string } }
  expect(initial.metadata.previous).toBeNull()
  expect(initial.metadata.target.id).toBe('beta')
  expect(initial.metadata.cause).toBe('unknown')
})
```

- [ ] **Step 3.3: Build the plugin (so `dist/index.js` exists for the test import) and run the test to confirm it fails**

Run:
```bash
pnpm -C plugins/plugin-focus-element build
pnpm -C plugins/plugin-focus-element test
```
Expected: FAIL — `focusEvents.length` is 0 (the browser script is a no-op stub).

- [ ] **Step 3.4: Commit the failing test**

```bash
git add plugins/plugin-focus-element/test
git commit -m "plugin-focus-element: failing test for initial focus snapshot"
```

---

## Task 4: Implement initial focus snapshot in `browser.ts`

**Files:**
- Modify: `plugins/plugin-focus-element/src/browser.ts`

- [ ] **Step 4.1: Write the minimal browser script to push an initial focus event**

```ts
type ConfigEntry = { kind: 'string'; value: string } | { kind: 'regex'; source: string; flags: string }
declare const __introspect_focus_config__: ConfigEntry[] | null

interface ElementInfo {
  tag: string
  id: string | null
  classList: string[]
  testid: string | null
  role: string | null
  accessibleName: string | null
  text: string | null
  selector: string
  shadowPath: string[] | null
  backendNodeId: number | null
}

;(() => {
  if (!originAllowed()) return

  function originAllowed(): boolean {
    const config = typeof __introspect_focus_config__ !== 'undefined' ? __introspect_focus_config__ : null
    if (!config) return true
    return config.some((entry) =>
      entry.kind === 'string'
        ? entry.value === location.origin
        : new RegExp(entry.source, entry.flags).test(location.origin)
    )
  }

  function push(metadata: Record<string, unknown>): void {
    ;(window as unknown as { __introspect_push__: (payload: string) => void }).__introspect_push__(
      JSON.stringify({ type: 'focus.changed', metadata })
    )
  }

  function describe(element: Element | null): ElementInfo | null {
    if (!element) return null
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      classList: Array.from(element.classList),
      testid: element.getAttribute('data-testid'),
      role: element.getAttribute('role'),
      accessibleName: element.getAttribute('aria-label'),
      text: null,
      selector: element.tagName.toLowerCase() + (element.id ? `#${element.id}` : ''),
      shadowPath: null,
      backendNodeId: null,
    }
  }

  function emitInitial(): void {
    const target = describe(document.activeElement)
    const metadata: Record<string, unknown> = {
      target,
      previous: null,
      cause: 'unknown',
    }
    if (window.top !== window) metadata.origin = location.origin
    push(metadata)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', emitInitial, { once: true })
  } else {
    emitInitial()
  }
  window.addEventListener('pageshow', emitInitial)
})()
```

This is intentionally minimal — `describe()` will be expanded in later tasks. Stub fields are filled in then.

- [ ] **Step 4.2: Rebuild and run the test**

```bash
pnpm -C plugins/plugin-focus-element build && pnpm -C plugins/plugin-focus-element test
```
Expected: PASS.

- [ ] **Step 4.3: Commit**

```bash
git add plugins/plugin-focus-element/src/browser.ts
git commit -m "plugin-focus-element: emit initial focus snapshot"
```

---

## Task 5: Test + implement focusin tracking with `previous`

**Files:**
- Modify: `plugins/plugin-focus-element/test/focus.spec.ts`
- Modify: `plugins/plugin-focus-element/src/browser.ts`

- [ ] **Step 5.1: Add the failing test**

Append to `test/focus.spec.ts`:

```ts
test('tracks user-driven focus moves with previous chain', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [focusElement()] })
  await gotoFixture(page, 'simple.html')
  await page.waitForFunction(() => document.activeElement?.id === 'beta')
  await page.locator('#alpha').focus()
  await page.locator('#go').focus()
  await handle.flush()
  await handle.detach()

  const events = (await readEvents(outDir)).filter((e) => e.type === 'focus.changed') as Array<{
    metadata: { target: { id: string } | null; previous: { id: string } | null; cause: string }
  }>
  // initial + 2 transitions = 3
  expect(events.length).toBe(3)
  expect(events[1].metadata.previous?.id).toBe('beta')
  expect(events[1].metadata.target?.id).toBe('alpha')
  expect(events[2].metadata.previous?.id).toBe('alpha')
  expect(events[2].metadata.target?.id).toBe('go')
})
```

Note: `page.locator('#alpha').focus()` triggers focus via Playwright's input automation (a real CDP `Input.dispatchKeyEvent` / programmatic-from-CDP path). For this test we only assert the chain — the cause assertion is in Task 6.

- [ ] **Step 5.2: Run, expect FAIL (we don't track transitions yet)**

```bash
pnpm -C plugins/plugin-focus-element build && pnpm -C plugins/plugin-focus-element test
```

- [ ] **Step 5.3: Add `focusin` listener and `previous` tracking in `browser.ts`**

Replace `emitInitial` and add a listener. Updated relevant portion:

```ts
  let previous: ElementInfo | null = null

  function emitChange(target: ElementInfo | null, programmatic: { stack: string } | null): void {
    const metadata: Record<string, unknown> = {
      target,
      previous,
      ...(programmatic ? { cause: 'programmatic', callSite: programmatic.stack } : { cause: 'unknown' }),
    }
    if (window.top !== window) metadata.origin = location.origin
    push(metadata)
    previous = target
  }

  function emitInitial(): void {
    emitChange(describe(document.activeElement), null)
  }

  document.addEventListener('focusin', () => {
    emitChange(describe(document.activeElement), null)
  }, true)

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', emitInitial, { once: true })
  } else {
    emitInitial()
  }
  window.addEventListener('pageshow', emitInitial)
```

`focusin` is captured at the document level (capturing phase). Reading `document.activeElement` inside the handler is reliable: `focusin` fires *after* `activeElement` has been updated.

- [ ] **Step 5.4: Run, expect PASS**

```bash
pnpm -C plugins/plugin-focus-element build && pnpm -C plugins/plugin-focus-element test
```

- [ ] **Step 5.5: Commit**

```bash
git add plugins/plugin-focus-element
git commit -m "plugin-focus-element: track focus transitions with previous chain"
```

---

## Task 6: Test + implement programmatic-cause detection with `callSite`

**Files:**
- Modify: `plugins/plugin-focus-element/test/focus.spec.ts`
- Modify: `plugins/plugin-focus-element/src/browser.ts`

- [ ] **Step 6.1: Add the failing test**

Append:

```ts
test('classifies .focus() calls as programmatic with callSite', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [focusElement()] })
  await gotoFixture(page, 'simple.html')
  await page.waitForFunction(() => document.activeElement?.id === 'beta')

  await page.evaluate(() => {
    function focusAlphaFromHelper() {
      (document.getElementById('alpha') as HTMLInputElement).focus()
    }
    focusAlphaFromHelper()
  })
  await handle.flush()
  await handle.detach()

  const events = (await readEvents(outDir)).filter((e) => e.type === 'focus.changed') as Array<{
    metadata: { target: { id: string } | null; cause: string; callSite?: string }
  }>
  const programmatic = events.find((e) => e.metadata.target?.id === 'alpha')
  expect(programmatic).toBeDefined()
  expect(programmatic!.metadata.cause).toBe('programmatic')
  expect(programmatic!.metadata.callSite).toBeDefined()
  expect(programmatic!.metadata.callSite).toMatch(/focusAlphaFromHelper/)
})
```

- [ ] **Step 6.2: Run, expect FAIL (cause is still always 'unknown')**

- [ ] **Step 6.3: Add the `.focus()` / `.blur()` patch in `browser.ts`**

At the top of the IIFE (after `originAllowed()` check, before the listener), add:

```ts
  let pendingProgrammatic: { stack: string } | null = null

  const realFocus = HTMLElement.prototype.focus
  HTMLElement.prototype.focus = function (this: HTMLElement, ...args: unknown[]) {
    pendingProgrammatic = { stack: cleanStack(new Error().stack ?? '') }
    try { return realFocus.apply(this, args as []) } finally { pendingProgrammatic = null }
  }

  const realBlur = HTMLElement.prototype.blur
  HTMLElement.prototype.blur = function (this: HTMLElement, ...args: unknown[]) {
    pendingProgrammatic = { stack: cleanStack(new Error().stack ?? '') }
    try { return realBlur.apply(this, args as []) } finally { pendingProgrammatic = null }
  }

  function cleanStack(stack: string): string {
    // Drop the first frame (the patch wrapper itself); keep everything else verbatim.
    const lines = stack.split('\n')
    return lines.length > 1 ? [lines[0], ...lines.slice(2)].join('\n') : stack
  }
```

Then update the `focusin` listener to read the flag:

```ts
  document.addEventListener('focusin', () => {
    emitChange(describe(document.activeElement), pendingProgrammatic)
  }, true)
```

The patch + read happen synchronously: `realFocus.apply()` dispatches `focusin` synchronously before returning, so the listener sees the still-set flag. `try/finally` clears it before any async work resumes.

- [ ] **Step 6.4: Run, expect PASS**

```bash
pnpm -C plugins/plugin-focus-element build && pnpm -C plugins/plugin-focus-element test
```

- [ ] **Step 6.5: Commit**

```bash
git add plugins/plugin-focus-element
git commit -m "plugin-focus-element: classify programmatic .focus() with callSite"
```

---

## Task 7: Test + flesh out `ElementInfo` (role, accessibleName, testid, selector, text)

**Files:**
- Modify: `plugins/plugin-focus-element/test/focus.spec.ts`
- Modify: `plugins/plugin-focus-element/src/browser.ts`

- [ ] **Step 7.1: Add the failing test**

Append:

```ts
test('captures role, accessibleName, testid, selector, text on target', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [focusElement()] })
  await gotoFixture(page, 'simple.html')
  await page.waitForFunction(() => document.activeElement?.id === 'beta')
  await page.locator('#go').focus()
  await handle.flush()
  await handle.detach()

  const events = (await readEvents(outDir)).filter((e) => e.type === 'focus.changed') as Array<{
    metadata: { target: {
      tag: string; id: string | null; testid: string | null; role: string | null;
      accessibleName: string | null; text: string | null; selector: string
    } | null }
  }>
  const buttonEvent = events.find((e) => e.metadata.target?.id === 'go')
  expect(buttonEvent).toBeDefined()
  const { target } = buttonEvent!.metadata
  expect(target!.tag).toBe('button')
  expect(target!.testid).toBe('go-btn')
  expect(target!.role).toBe('button')          // implicit role from tag
  expect(target!.accessibleName).toBe('Go')    // from innerText fallback
  expect(target!.text).toBe('Go')
  expect(target!.selector).toBe('button#go')

  const inputEvent = events.find((e) => e.metadata.target?.id === 'beta')
  expect(inputEvent!.metadata.target!.role).toBe('textbox')
  expect(inputEvent!.metadata.target!.accessibleName).toBe('Beta')  // from aria-label
})
```

- [ ] **Step 7.2: Run, expect FAIL**

- [ ] **Step 7.3: Expand `describe()` in `browser.ts`**

Replace the stub `describe()`:

```ts
  const IMPLICIT_ROLES: Record<string, string> = {
    button: 'button',
    a: 'link',           // only when href is present (handled below)
    textarea: 'textbox',
    select: 'combobox',
    nav: 'navigation',
    main: 'main',
    header: 'banner',
    footer: 'contentinfo',
    aside: 'complementary',
  }
  const INPUT_ROLES: Record<string, string> = {
    text: 'textbox', search: 'searchbox', email: 'textbox', tel: 'textbox',
    url: 'textbox', password: 'textbox', number: 'spinbutton',
    checkbox: 'checkbox', radio: 'radio', range: 'slider',
    submit: 'button', button: 'button', reset: 'button',
  }

  function implicitRole(element: Element): string | null {
    const tag = element.tagName.toLowerCase()
    if (tag === 'input') {
      const type = (element.getAttribute('type') ?? 'text').toLowerCase()
      return INPUT_ROLES[type] ?? 'textbox'
    }
    if (tag === 'a') return element.hasAttribute('href') ? 'link' : null
    return IMPLICIT_ROLES[tag] ?? null
  }

  function accessibleNameOf(element: Element): string | null {
    const ariaLabel = element.getAttribute('aria-label')
    if (ariaLabel) return ariaLabel.trim() || null
    const labelledBy = element.getAttribute('aria-labelledby')
    if (labelledBy) {
      const referenced = labelledBy.split(/\s+/).map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '').join(' ').trim()
      if (referenced) return referenced
    }
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
      const id = element.id
      if (id) {
        const label = element.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`)
        if (label?.textContent) return label.textContent.trim() || null
      }
      const closest = element.closest('label')
      if (closest?.textContent) return closest.textContent.trim() || null
    }
    const text = (element as HTMLElement).innerText?.trim()
    if (text) return text.length > 120 ? text.slice(0, 117) + '…' : text
    return null
  }

  function selectorFor(element: Element): string {
    const tag = element.tagName.toLowerCase()
    if (element.id) return `${tag}#${element.id}`
    const segments: string[] = []
    let current: Element | null = element
    let depth = 0
    while (current && current !== current.ownerDocument.documentElement && depth < 6) {
      const segmentTag = current.tagName.toLowerCase()
      if (current.id) {
        segments.unshift(`${segmentTag}#${current.id}`)
        break
      }
      const parent = current.parentElement
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === current!.tagName)
        const index = sameTag.indexOf(current)
        segments.unshift(sameTag.length > 1 ? `${segmentTag}:nth-of-type(${index + 1})` : segmentTag)
      } else {
        segments.unshift(segmentTag)
      }
      current = parent
      depth++
    }
    return segments.join(' > ')
  }

  function describe(element: Element | null): ElementInfo | null {
    if (!element) return null
    const tag = element.tagName.toLowerCase()
    const text = (element as HTMLElement).innerText?.trim() ?? null
    return {
      tag,
      id: element.id || null,
      classList: Array.from(element.classList),
      testid: element.getAttribute('data-testid'),
      role: element.getAttribute('role') ?? implicitRole(element),
      accessibleName: accessibleNameOf(element),
      text: text ? (text.length > 120 ? text.slice(0, 117) + '…' : text) : null,
      selector: selectorFor(element),
      shadowPath: null,
      backendNodeId: null,
    }
  }
```

- [ ] **Step 7.4: Run, expect PASS**

```bash
pnpm -C plugins/plugin-focus-element build && pnpm -C plugins/plugin-focus-element test
```

- [ ] **Step 7.5: Commit**

```bash
git add plugins/plugin-focus-element
git commit -m "plugin-focus-element: populate role, accessibleName, testid, selector"
```

---

## Task 8: Test + implement shadow-DOM walking (`shadowPath`)

**Files:**
- Create: `plugins/plugin-focus-element/test/fixtures/shadow.html`
- Modify: `plugins/plugin-focus-element/test/focus.spec.ts`
- Modify: `plugins/plugin-focus-element/src/browser.ts`

- [ ] **Step 8.1: Write `test/fixtures/shadow.html`**

```html
<!doctype html>
<html>
<body>
  <my-card id="card">
    <template shadowrootmode="open">
      <input id="inner-input" data-testid="inner" aria-label="Inner" />
    </template>
  </my-card>
  <button id="trigger">trigger</button>
  <script>
    document.getElementById('trigger').addEventListener('click', () => {
      document.getElementById('card').shadowRoot.getElementById('inner-input').focus()
    })
  </script>
</body>
</html>
```

(Browsers that support declarative shadow DOM via `<template shadowrootmode>` will attach the shadow root automatically — Playwright's bundled Chromium does.)

- [ ] **Step 8.2: Add the failing test**

Append:

```ts
test('walks shadow DOM and reports shadowPath on target', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [focusElement()] })
  await gotoFixture(page, 'shadow.html')
  await page.locator('#trigger').click()
  await page.waitForFunction(() => {
    const host = document.getElementById('card') as HTMLElement & { shadowRoot: ShadowRoot }
    return host.shadowRoot?.activeElement?.id === 'inner-input'
  })
  await handle.flush()
  await handle.detach()

  const events = (await readEvents(outDir)).filter((e) => e.type === 'focus.changed') as Array<{
    metadata: { target: { id: string | null; tag: string; shadowPath: string[] | null } | null }
  }>
  const inner = events.find((e) => e.metadata.target?.id === 'inner-input')
  expect(inner).toBeDefined()
  expect(inner!.metadata.target!.tag).toBe('input')
  expect(inner!.metadata.target!.shadowPath).toEqual(['my-card#card'])
})
```

- [ ] **Step 8.3: Run, expect FAIL (shadow walk not implemented)**

- [ ] **Step 8.4: Update `browser.ts` to walk shadow roots**

Add a helper above `describe()` and call it from the listener:

```ts
  function deepActiveElement(): { element: Element | null; shadowPath: string[] } {
    const path: string[] = []
    let current: Element | null = document.activeElement
    while (current && (current as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot) {
      const shadow = (current as Element & { shadowRoot: ShadowRoot }).shadowRoot
      const next = shadow.activeElement
      if (!next) break
      path.push(selectorFor(current))
      current = next
    }
    return { element: current, shadowPath: path }
  }

  function describeDeep(): ElementInfo | null {
    const { element, shadowPath } = deepActiveElement()
    const info = describe(element)
    if (info && shadowPath.length > 0) info.shadowPath = shadowPath
    return info
  }
```

Update the listener and `emitInitial` to call `describeDeep()` instead of `describe(document.activeElement)`:

```ts
  function emitInitial(): void {
    emitChange(describeDeep(), null)
  }

  document.addEventListener('focusin', () => {
    emitChange(describeDeep(), pendingProgrammatic)
  }, true)
```

- [ ] **Step 8.5: Run, expect PASS**

- [ ] **Step 8.6: Commit**

```bash
git add plugins/plugin-focus-element
git commit -m "plugin-focus-element: walk shadow DOM and emit shadowPath"
```

---

## Task 9: Test + implement focus-leaves-document (target null)

**Files:**
- Modify: `plugins/plugin-focus-element/test/focus.spec.ts`
- Modify: `plugins/plugin-focus-element/src/browser.ts`

- [ ] **Step 9.1: Add the failing test**

Append:

```ts
test('emits target=null when focus leaves the document', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [focusElement()] })
  await gotoFixture(page, 'simple.html')
  await page.waitForFunction(() => document.activeElement?.id === 'beta')

  await page.evaluate(() => {
    (document.activeElement as HTMLElement).blur()
  })
  await handle.flush()
  await handle.detach()

  const events = (await readEvents(outDir)).filter((e) => e.type === 'focus.changed') as Array<{
    metadata: { target: unknown; previous: { id: string } | null }
  }>
  const blurred = events.find((e) => e.metadata.target === null)
  expect(blurred).toBeDefined()
  expect(blurred!.metadata.previous?.id).toBe('beta')
})
```

- [ ] **Step 9.2: Run, expect FAIL**

- [ ] **Step 9.3: Add a narrow `focusout` listener in `browser.ts`**

After the `focusin` listener:

```ts
  document.addEventListener('focusout', (event) => {
    if ((event as FocusEvent).relatedTarget !== null) return
    queueMicrotask(() => {
      const active = document.activeElement
      if (!active || active === document.body) {
        emitChange(null, pendingProgrammatic)
      }
    })
  }, true)
```

The `queueMicrotask` lets the browser settle `activeElement` to `body`/`null` before we read it. We only emit when no `focusin` will follow (i.e. focus genuinely left).

- [ ] **Step 9.4: Run, expect PASS**

- [ ] **Step 9.5: Commit**

```bash
git add plugins/plugin-focus-element
git commit -m "plugin-focus-element: emit target=null when focus leaves document"
```

---

## Task 10: Test + verify same-origin iframe support (`origin` field)

**Files:**
- Create: `plugins/plugin-focus-element/test/fixtures/iframe-parent.html`
- Create: `plugins/plugin-focus-element/test/fixtures/iframe-child.html`
- Modify: `plugins/plugin-focus-element/test/focus.spec.ts`

(No `browser.ts` changes expected — Playwright's `addInitScript` already injects into all same-origin frames, and the existing code already sets `origin` when `window.top !== window`.)

- [ ] **Step 10.1: Write the parent fixture**

`test/fixtures/iframe-parent.html`:
```html
<!doctype html>
<html>
<body>
  <input id="parent-input" aria-label="Parent" />
  <iframe id="frame" src="./iframe-child.html"></iframe>
</body>
</html>
```

- [ ] **Step 10.2: Write the child fixture**

`test/fixtures/iframe-child.html`:
```html
<!doctype html>
<html>
<body>
  <input id="child-input" aria-label="Child" />
</body>
</html>
```

- [ ] **Step 10.3: Add the failing test**

Append:

```ts
test('child frame emits its own events tagged with origin', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [focusElement()] })
  await gotoFixture(page, 'iframe-parent.html')

  const childFrame = page.frameLocator('#frame')
  await childFrame.locator('#child-input').focus()
  await handle.flush()
  await handle.detach()

  const events = (await readEvents(outDir)).filter((e) => e.type === 'focus.changed') as Array<{
    metadata: { target: { id: string | null } | null; origin?: string }
  }>
  const childEvent = events.find((e) => e.metadata.target?.id === 'child-input')
  expect(childEvent).toBeDefined()
  expect(childEvent!.metadata.origin).toBeDefined()
  expect(childEvent!.metadata.origin).toMatch(/^file:\/\//)  // file URLs use 'file://' as origin

  const mainEvents = events.filter((e) => e.metadata.origin === undefined)
  expect(mainEvents.length).toBeGreaterThan(0)  // main-frame events have no origin field
})
```

- [ ] **Step 10.4: Run**

```bash
pnpm -C plugins/plugin-focus-element build && pnpm -C plugins/plugin-focus-element test
```

If this PASSES on the first run, great — the existing `origin` logic + Playwright's per-frame init script handles it. If FAIL, check that `addInitScript` is being called per-frame in `attach()`; per CONTRIBUTING that's the case for browser scripts.

- [ ] **Step 10.5: Commit**

```bash
git add plugins/plugin-focus-element
git commit -m "plugin-focus-element: test same-origin iframe emits with origin"
```

---

## Task 11: Test + implement `origins` option gating

**Files:**
- Modify: `plugins/plugin-focus-element/test/focus.spec.ts`

(No `browser.ts` change — `originAllowed()` is already in place from Task 4.)

- [ ] **Step 11.1: Add the failing test**

Append:

```ts
test('origins option gates injection per frame', async ({ page }) => {
  const handle = await attach(page, {
    outDir,
    plugins: [focusElement({ origins: ['https://nope.example'] })],
  })
  await gotoFixture(page, 'simple.html')
  await page.waitForFunction(() => document.activeElement?.id === 'beta')
  await page.locator('#alpha').focus()
  await handle.flush()
  await handle.detach()

  const events = (await readEvents(outDir)).filter((e) => e.type === 'focus.changed')
  expect(events.length).toBe(0)
})

test('origins option accepts RegExp', async ({ page }) => {
  const handle = await attach(page, {
    outDir,
    plugins: [focusElement({ origins: [/^file:\/\//] })],
  })
  await gotoFixture(page, 'simple.html')
  await page.waitForFunction(() => document.activeElement?.id === 'beta')
  await handle.flush()
  await handle.detach()

  const events = (await readEvents(outDir)).filter((e) => e.type === 'focus.changed')
  expect(events.length).toBeGreaterThan(0)
})
```

- [ ] **Step 11.2: Run**

```bash
pnpm -C plugins/plugin-focus-element build && pnpm -C plugins/plugin-focus-element test
```

If the gate works (it should, having been written in Task 4), both tests PASS. If not, debug the `serialiseOrigins` / `originAllowed` round trip — most likely a quoting issue in the inlined config string.

- [ ] **Step 11.3: Commit**

```bash
git add plugins/plugin-focus-element
git commit -m "plugin-focus-element: test origins option gates injection"
```

---

## Task 12: Modal-trap regression test

**Files:**
- Create: `plugins/plugin-focus-element/test/fixtures/modal.html`
- Modify: `plugins/plugin-focus-element/test/focus.spec.ts`

- [ ] **Step 12.1: Write the fixture**

`test/fixtures/modal.html`:
```html
<!doctype html>
<html>
<body>
  <button id="open" data-testid="open">Open</button>
  <div id="modal" hidden>
    <input id="modal-input" aria-label="In modal" />
    <button id="close" data-testid="close">Close</button>
  </div>
  <script>
    const open = document.getElementById('open')
    const modal = document.getElementById('modal')
    const input = document.getElementById('modal-input')
    const close = document.getElementById('close')
    let returnTo = null
    open.addEventListener('click', () => {
      returnTo = document.activeElement
      modal.hidden = false
      input.focus()
    })
    close.addEventListener('click', () => {
      modal.hidden = true
      returnTo?.focus()
    })
  </script>
</body>
</html>
```

- [ ] **Step 12.2: Add the test**

Append:

```ts
test('captures modal open/close focus trap with programmatic causes', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [focusElement()] })
  await gotoFixture(page, 'modal.html')
  await page.locator('#open').focus()  // ensure 'open' has focus before clicking
  await page.locator('#open').click()
  await page.waitForFunction(() => document.activeElement?.id === 'modal-input')
  await page.locator('#close').click()
  await page.waitForFunction(() => document.activeElement?.id === 'open')
  await handle.flush()
  await handle.detach()

  const events = (await readEvents(outDir)).filter((e) => e.type === 'focus.changed') as Array<{
    metadata: { target: { id: string | null } | null; cause: string }
  }>
  const intoModal = events.find((e) => e.metadata.target?.id === 'modal-input')
  const backToOpen = events.slice().reverse().find((e) => e.metadata.target?.id === 'open')
  expect(intoModal!.metadata.cause).toBe('programmatic')
  expect(backToOpen!.metadata.cause).toBe('programmatic')
})
```

- [ ] **Step 12.3: Run, expect PASS (no implementation changes needed)**

```bash
pnpm -C plugins/plugin-focus-element test
```

- [ ] **Step 12.4: Commit**

```bash
git add plugins/plugin-focus-element
git commit -m "plugin-focus-element: regression test for modal focus trap"
```

---

## Task 13: README

**Files:**
- Create: `plugins/plugin-focus-element/README.md`

- [ ] **Step 13.1: Write `README.md`**

```markdown
# @introspection/plugin-focus-element

Tracks focus changes during a Playwright session — every `focusin`, every `.focus()` call, including shadow DOM and same-origin iframes.

## Install

```bash
pnpm add -D @introspection/plugin-focus-element
```

## Usage

```ts
import { attach } from '@introspection/playwright'
import { focusElement } from '@introspection/plugin-focus-element'

const handle = await attach(page, {
  outDir: './.introspect',
  plugins: [focusElement()],
})
```

## Events

| Type | Fires when |
|---|---|
| `focus.changed` | Focus moves between elements, or leaves/enters the document |

### `focus.changed` metadata

```ts
{
  target: ElementInfo | null,        // null when focus leaves document
  previous: ElementInfo | null,
  cause: 'programmatic' | 'unknown',
  callSite?: string,                 // raw stack, set when cause === 'programmatic'
  origin?: string,                   // location.origin; set only in sub-frames
}

ElementInfo {
  tag, id, classList, testid,
  role, accessibleName,              // implicit role + aria-label/labelledby/<label>/innerText
  text,                              // truncated innerText
  selector,                          // CSS path
  shadowPath: string[] | null,       // host selectors deepest-last
  backendNodeId: number | null,      // null in v1
}
```

## Options

```ts
focusElement({
  origins: ['http://localhost:3000', /\.myapp\.com$/],
  verbose: true,
})
```

- `origins` — restrict the plugin to frames whose `location.origin` matches. Strings are exact-match; RegExps are tested against `location.origin`. Default: all frames.
- `verbose` — debug logging via `createDebug`.

## Querying

```bash
introspect events --type focus.changed
introspect events --type focus.changed --filter '$.metadata.cause == "programmatic"'
```

## Caveats

- **Cross-origin iframes** are not instrumented — they appear once as the `<iframe>` element on the parent's `focus.changed`, then go silent. (Tracked in `docs/superpowers/plans/2026-05-08-origins-option.md`.)
- **`backendNodeId`** is `null` in v1; obtaining it requires a CDP roundtrip per event and isn't worth the cost yet.
- **`callSite`** is the raw `Error().stack` string. The CLI/UI can resolve through source maps later — see how `plugin-js-error` normalises stacks.
- Patching `HTMLElement.prototype.focus`/`.blur` is observable to the page. Apps that themselves patch these methods will compose with ours fine (we call the original `apply()`), but apps that compare `HTMLElement.prototype.focus.toString()` will see a different string.
```

- [ ] **Step 13.2: Commit**

```bash
git add plugins/plugin-focus-element/README.md
git commit -m "plugin-focus-element: README"
```

---

## Task 14: Final verification

- [ ] **Step 14.1: Build and test the plugin from clean**

```bash
pnpm -C plugins/plugin-focus-element build
pnpm -C plugins/plugin-focus-element test
pnpm -C plugins/plugin-focus-element typecheck
```
Expected: build succeeds, all 8 tests pass, typecheck clean.

- [ ] **Step 14.2: Run the repo-wide test suite to verify nothing else broke**

```bash
pnpm test
```
Expected: all tests pass.

- [ ] **Step 14.3: Dogfood the CLI on a captured trace**

```bash
introspect events --type focus.changed --in plugins/plugin-focus-element/test-results
```
Expected: see the captured `focus.changed` events from the most recent test run. If the CLI surface is missing something obvious for these events (e.g. no flag to filter by `cause`), note it in `docs/ideas.md` per CONTRIBUTING — the project explicitly wants this kind of feedback.

- [ ] **Step 14.4: No extra commit** unless you added a note to `docs/ideas.md`, in which case:

```bash
git add docs/ideas.md
git commit -m "docs: note CLI gap surfaced while dogfooding plugin-focus-element"
```

---

## Self-review notes

**Spec coverage:** Each numbered point in the spec maps to a task — initial focus (Task 4), `previous` chain (Task 5), `.focus()` patch + callSite (Task 6), `ElementInfo` fields (Task 7), shadow DOM (Task 8), `target=null` on focus-leaves (Task 9), iframe `origin` (Task 10), `origins` option (Task 11), modal trap (Task 12). README (13). Build verification (14).

**Type consistency:** `ElementInfo`, `FocusCause`, `FocusChangedEvent` all match between spec and Task 2 (types) and Task 4+ (browser implementation). `cause` discriminator uses `'programmatic' | 'unknown'` everywhere. `origin` is optional everywhere.

**Open assumptions to verify during execution:**
- Playwright's `addInitScript` injects into same-origin child frames automatically — confirmed in CONTRIBUTING ("plugins use `page.addInitScript`"); Task 10 verifies empirically.
- `<template shadowrootmode="open">` declarative shadow DOM works in Playwright's bundled Chromium; if not, `shadow.html` needs to attach the shadow root via `customElements.define` instead.
- `focusin` fires synchronously inside the patched `.focus()` call — true per HTML spec; Task 6 verifies.
