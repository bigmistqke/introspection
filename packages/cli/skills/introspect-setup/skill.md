---
name: introspect-setup
description: Use when adding introspection to a project for the first time
---

# Setting up introspection

## 1. Install packages

```bash
# Required
pnpm add -D @introspection/vite @introspection/playwright

# Optional plugins (install only what you need)
pnpm add -D @introspection/plugin-react
pnpm add -D @introspection/plugin-redux
pnpm add -D @introspection/plugin-zustand
pnpm add -D @introspection/plugin-webgl

# Zero-boilerplate Playwright fixture (recommended)
pnpm add -D @introspection/playwright-fixture
```

## 2. Add the Vite plugin

In `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import { introspection } from '@introspection/vite'

export default defineConfig({
  plugins: [
    introspection({
      // plugins: [reactPlugin(), reduxPlugin()],
      // outDir: '.introspect',   // default
    }),
  ],
})
```

## 3. Attach in Playwright tests

**Option A: Manual (full control)**

```ts
import { test } from '@playwright/test'
import { attach } from '@introspection/playwright'

test('my test', async ({ page }) => {
  const handle = await attach(page)
  await handle.page.goto('/')        // use handle.page — proxy-wrapped for action tracking
  handle.mark('user submitted form') // optional semantic markers
  await handle.detach()
})
```

**Option B: Playwright fixture (recommended — zero boilerplate)**

```ts
// playwright.config.ts
import { test as base } from '@playwright/test'
import { introspectFixture } from '@introspection/playwright-fixture'

export const test = base.extend(introspectFixture)
export { expect } from '@playwright/test'
```

Then in tests:
```ts
import { test, expect } from './playwright.config'

test('my test', async ({ page }) => {
  await page.goto('/')   // page is already proxy-wrapped
})
```

## 4. Verify

```bash
# Run a test, then:
ls .introspect/           # should contain *.trace.json files
introspect summary        # should print a plain-language test summary
```

If `.introspect/` is empty:
- Confirm the Vite dev server is running when tests run (not a static build)
- Confirm `attach(page)` (or the fixture) is called before `page.goto()`
