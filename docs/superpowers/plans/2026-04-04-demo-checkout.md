# Demo: Checkout Validation Bug — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `demo/` workspace package — a small React/Redux checkout app with an intentional bug — wired with the introspection stack, so a fresh agent can discover the bug using only `pnpm exec introspect` commands.

**Architecture:** Three changes to existing packages (fix `playwright-fixture`, inject session ID from `attach.ts`, snapshot on JS error), then a self-contained `demo/` app. The demo depends on workspace packages via `workspace:*`. The Playwright test fails; the introspect CLI reveals why in 5–6 commands.

**Tech Stack:** Vite 5, React 18, Redux Toolkit 2, React Router 6, `@playwright/test`, `@introspection/vite`, `@introspection/playwright-fixture`, `@introspection/browser`, `@introspection/plugin-redux`

---

## File Map

### Existing files to modify

| File | Change |
|------|--------|
| `packages/playwright-fixture/src/index.ts` | Remove `TestResult` import; use inline type for `detach()` call |
| `packages/playwright/src/attach.ts` | Inject `__INTROSPECT_SESSION_ID__` + `__INTROSPECT_URL__` via `page.addInitScript`; call `requestSnapshot` on `Runtime.exceptionThrown` |
| `packages/playwright/test/attach.test.ts` | Add assertions for `addInitScript` call and `requestSnapshot` on JS error |
| `pnpm-workspace.yaml` | Add `- 'demo'` |

### New files to create

| File | Purpose |
|------|---------|
| `demo/package.json` | Workspace package with dev/test scripts |
| `demo/tsconfig.json` | TypeScript config for the React app |
| `demo/index.html` | Vite entry HTML |
| `demo/vite.config.ts` | Vite config with `introspection()` plugin |
| `demo/playwright.config.ts` | Playwright config with `webServer` block |
| `demo/src/main.tsx` | React entry point |
| `demo/src/App.tsx` | Router: `/checkout` and `/success` routes |
| `demo/src/store/checkoutSlice.ts` | Redux slice: `validationErrors` state |
| `demo/src/store/index.ts` | Redux store + browser agent + plugin-redux wiring |
| `demo/src/api/client.ts` | Fetch wrapper — **the bug lives here** |
| `demo/src/pages/CheckoutPage.tsx` | Card form, error display `[data-testid=card-error]` |
| `demo/src/pages/SuccessPage.tsx` | Success screen |
| `demo/e2e/checkout.spec.ts` | The failing Playwright test |
| `demo/README.md` | Minimal: setup + run instructions only |

---

## Task 1: Fix `playwright-fixture`

**Files:**
- Modify: `packages/playwright-fixture/src/index.ts`

The fixture imports `TestResult` from `@introspection/types` which was removed in the session-directory refactor. Fix it.

- [ ] **Step 1: Read the current file**

```bash
cat packages/playwright-fixture/src/index.ts
```

- [ ] **Step 2: Replace with fixed version**

Replace `packages/playwright-fixture/src/index.ts` entirely:

```ts
import { test as base, expect } from '@playwright/test'
import { attach } from '@introspection/playwright'
import type { IntrospectHandle } from '@introspection/types'

export interface IntrospectFixtureOptions {
  viteUrl?: string
  outDir?: string
}

export function introspectFixture(opts: IntrospectFixtureOptions = {}) {
  const test = base.extend<{ introspect: IntrospectHandle }>({
    introspect: [async ({ page }, use, testInfo) => {
      const handle = await attach(page, {
        testTitle: testInfo.title,
        testFile: testInfo.file,
        workerIndex: testInfo.workerIndex,
        ...(opts.viteUrl ? { viteUrl: opts.viteUrl } : {}),
        ...(opts.outDir ? { outDir: opts.outDir } : {}),
      })
      await use(handle)
      const knownStatuses = ['passed', 'failed', 'timedOut', 'skipped'] as const
      const status = (knownStatuses as readonly string[]).includes(testInfo.status ?? '')
        ? testInfo.status as typeof knownStatuses[number]
        : 'failed' as const
      await handle.detach({ status, duration: testInfo.duration, error: testInfo.error?.message })
    }, { auto: true }],
  })
  return { test, expect }
}

export const { test, expect: _expect } = introspectFixture()
export { _expect as expect }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd packages/playwright-fixture && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/playwright-fixture/src/index.ts
git commit -m "fix(playwright-fixture): remove deleted TestResult type, use inline detach shape"
```

---

## Task 2: Enhance `attach.ts` — session ID injection + snapshot on error

**Files:**
- Modify: `packages/playwright/src/attach.ts`
- Modify: `packages/playwright/test/attach.test.ts`

Two additions:
1. Inject `window.__INTROSPECT_SESSION_ID__` and `window.__INTROSPECT_URL__` via `page.addInitScript` so browser-side plugins (like `plugin-redux`) can connect to the same session.
2. Call `requestSnapshot(sessionId, 'js.error')` when `Runtime.exceptionThrown` fires, so `introspect snapshot` shows locals at the error site.

- [ ] **Step 1: Read `attach.ts` to find exact insertion points**

```bash
cat packages/playwright/src/attach.ts
```

- [ ] **Step 2: Add `addInitScript` call**

Find this line (around line 42):
```ts
const startedAt = Date.now()
```

Add immediately after it, before the WebSocket connection:
```ts
// Inject session context into the page so browser-side plugins can connect
await page.addInitScript({
  content: `window.__INTROSPECT_SESSION_ID__="${sessionId}";window.__INTROSPECT_WS_URL__="${viteUrl}";`,
})
```

Wait — `page.addInitScript` must be called before `page.goto()`, but it can be called at any point. The init script runs at the start of every page load. This must be called before the Playwright WebSocket connection (in case the test navigates immediately after `attach`). Place it as the very first line in `attach()`, before the `ws = new WebSocket(...)` line.

Exact placement — insert after `let currentUrl = ''`:

```ts
// Inject session context so browser-side plugins (e.g. plugin-redux) can connect
await page.addInitScript({
  content: `window.__INTROSPECT_SESSION_ID__="${sessionId}";window.__INTROSPECT_WS_URL__="${viteUrl}";`,
})
```

- [ ] **Step 3: Add snapshot on `Runtime.exceptionThrown`**

Find:
```ts
cdp.on('Runtime.exceptionThrown', (params) => {
  sendEvent(normaliseCdpJsError(params as never, sessionId, startedAt))
})
```

Replace with:
```ts
cdp.on('Runtime.exceptionThrown', (params) => {
  sendEvent(normaliseCdpJsError(params as never, sessionId, startedAt))
  void server.requestSnapshot(sessionId, 'js.error')
})
```

- [ ] **Step 4: Read the test file to understand its structure**

```bash
cat packages/playwright/test/attach.test.ts
```

- [ ] **Step 5: Add tests for the new behaviour**

Find the section with `makeFakePage()` helper and existing tests. Add two new tests:

```ts
it('injects __INTROSPECT_SESSION_ID__ and __INTROSPECT_URL__ into the page', async () => {
  const { page, addInitScriptCalls } = makeFakePage()
  await attach(page as never, { ...baseOpts, sessionId: 'sess-inject' })
  expect(addInitScriptCalls.length).toBeGreaterThan(0)
  const injected = addInitScriptCalls.map((c: { content?: string }) => c.content ?? '').join('')
  expect(injected).toContain('sess-inject')
  expect(injected).toContain('__INTROSPECT_SESSION_ID__')
})

it('calls requestSnapshot when Runtime.exceptionThrown fires', async () => {
  const { page, triggerCdpEvent } = makeFakePage()
  await attach(page as never, { ...baseOpts, sessionId: 'sess-snap' })
  triggerCdpEvent('Runtime.exceptionThrown', {
    timestamp: 1000,
    exceptionDetails: {
      text: 'Uncaught TypeError',
      exception: { description: 'TypeError: Cannot read properties of undefined' },
      stackTrace: { callFrames: [] },
    },
  })
  expect(serverProxy.requestSnapshot).toHaveBeenCalledWith('sess-snap', 'js.error')
})
```

This requires `makeFakePage()` to:
- Track `page.addInitScript()` calls in an `addInitScriptCalls` array
- Expose a `triggerCdpEvent(name, params)` helper to simulate CDP events

Read the existing `makeFakePage()` implementation and extend it — do NOT rewrite it. Add `addInitScriptCalls` array tracking and `triggerCdpEvent` method to the existing fake.

Also add `requestSnapshot: vi.fn()` to `serverProxy` if not already present.

- [ ] **Step 6: Run tests**

```bash
cd packages/playwright && npx vitest run test/attach.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/playwright/src/attach.ts packages/playwright/test/attach.test.ts
git commit -m "feat(playwright): inject session ID into page, snapshot on JS error"
```

---

## Task 3: Demo workspace scaffold

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `demo/package.json`
- Create: `demo/tsconfig.json`
- Create: `demo/index.html`
- Create: `demo/vite.config.ts`
- Create: `demo/playwright.config.ts`

- [ ] **Step 1: Add demo to workspace**

Edit `pnpm-workspace.yaml` — add `- 'demo'`:

```yaml
packages:
  - 'packages/*'
  - 'demo'
```

- [ ] **Step 2: Create `demo/package.json`**

```json
{
  "name": "@introspection/demo",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "playwright test"
  },
  "dependencies": {
    "@reduxjs/toolkit": "^2.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-redux": "^9.0.0",
    "react-router-dom": "^6.0.0"
  },
  "devDependencies": {
    "@introspection/browser": "workspace:*",
    "@introspection/playwright-fixture": "workspace:*",
    "@introspection/plugin-redux": "workspace:*",
    "@introspection/vite": "workspace:*",
    "@playwright/test": "^1.40.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.4.0",
    "vite": "^5.0.0"
  }
}
```

- [ ] **Step 3: Create `demo/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `demo/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Checkout Demo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `demo/vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { introspection } from '@introspection/vite'

export default defineConfig({
  plugins: [react(), introspection()],
})
```

- [ ] **Step 6: Create `demo/playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
})
```

- [ ] **Step 7: Install dependencies**

```bash
cd /path/to/monorepo && pnpm install
```

Expected: demo package linked, no errors.

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml demo/package.json demo/tsconfig.json demo/index.html demo/vite.config.ts demo/playwright.config.ts
git commit -m "feat(demo): add workspace scaffold"
```

---

## Task 4: Demo app code

**Files:**
- Create: `demo/src/main.tsx`
- Create: `demo/src/App.tsx`
- Create: `demo/src/store/checkoutSlice.ts`
- Create: `demo/src/store/index.ts`
- Create: `demo/src/api/client.ts`
- Create: `demo/src/pages/CheckoutPage.tsx`
- Create: `demo/src/pages/SuccessPage.tsx`

- [ ] **Step 1: Create `demo/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import { store } from './store/index.js'
import App from './App.js'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Provider>
  </StrictMode>,
)
```

- [ ] **Step 2: Create `demo/src/App.tsx`**

```tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import CheckoutPage from './pages/CheckoutPage.js'
import SuccessPage from './pages/SuccessPage.js'

export default function App() {
  return (
    <Routes>
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/success" element={<SuccessPage />} />
      <Route path="*" element={<Navigate to="/checkout" replace />} />
    </Routes>
  )
}
```

- [ ] **Step 3: Create `demo/src/store/checkoutSlice.ts`**

```ts
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

interface CheckoutState {
  validationErrors: string[] | null
}

const initialState: CheckoutState = { validationErrors: null }

export const checkoutSlice = createSlice({
  name: 'checkout',
  initialState,
  reducers: {
    setValidationErrors(state, action: PayloadAction<string[]>) {
      state.validationErrors = action.payload
    },
    clearValidationErrors(state) {
      state.validationErrors = null
    },
  },
})

export const { setValidationErrors, clearValidationErrors } = checkoutSlice.actions
export default checkoutSlice.reducer
```

- [ ] **Step 4: Create `demo/src/store/index.ts`**

```ts
import { configureStore } from '@reduxjs/toolkit'
import { BrowserAgent } from '@introspection/browser'
import { createReduxPlugin } from '@introspection/plugin-redux'
import checkoutReducer from './checkoutSlice.js'

export const store = configureStore({
  reducer: { checkout: checkoutReducer },
})

// Connect to the introspection server when running inside a Playwright session.
// attach() in @introspection/playwright injects these globals via page.addInitScript().
const w = window as Window & { __INTROSPECT_SESSION_ID__?: string; __INTROSPECT_WS_URL__?: string }
if (w.__INTROSPECT_SESSION_ID__) {
  const agent = BrowserAgent.connect(
    w.__INTROSPECT_WS_URL__ ?? 'ws://localhost:5173/__introspection',
    w.__INTROSPECT_SESSION_ID__,
  )
  agent.use(createReduxPlugin(store))
}

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
```

- [ ] **Step 5: Create `demo/src/api/client.ts`**

```ts
interface ApiResponse<T = unknown> {
  status: number
  data: T | undefined
}

async function post<T = unknown>(url: string, body: unknown): Promise<ApiResponse<T>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.ok) return { status: res.status, data: (await res.json()) as T }
  return { status: res.status, data: undefined }  // bug: body not parsed on 4xx
}

export const api = { post }
```

- [ ] **Step 6: Create `demo/src/pages/CheckoutPage.tsx`**

```tsx
import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { api } from '../api/client.js'
import { setValidationErrors, clearValidationErrors } from '../store/checkoutSlice.js'
import type { RootState } from '../store/index.js'

export default function CheckoutPage() {
  const [card, setCard] = useState('')
  const dispatch = useDispatch()
  const errors = useSelector((s: RootState) => s.checkout.validationErrors)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    dispatch(clearValidationErrors())
    const response = await api.post<{ errors: Array<{ field: string; message: string }> }>(
      '/api/payment/validate',
      { card },
    )
    // bug: response.data is undefined when server returns 4xx — throws TypeError
    dispatch(setValidationErrors(response.data!.errors.map(err => err.message)))
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Checkout</h1>
      <label>
        Card number
        <input name="card" value={card} onChange={e => setCard(e.target.value)} />
      </label>
      {errors && (
        <ul data-testid="card-error">
          {errors.map((msg, i) => <li key={i}>{msg}</li>)}
        </ul>
      )}
      <button type="submit">Pay now</button>
    </form>
  )
}
```

- [ ] **Step 7: Create `demo/src/pages/SuccessPage.tsx`**

```tsx
export default function SuccessPage() {
  return <h1>Payment successful!</h1>
}
```

- [ ] **Step 8: Commit**

```bash
git add demo/src/
git commit -m "feat(demo): add React/Redux checkout app with intentional bug"
```

---

## Task 5: Failing test and README

**Files:**
- Create: `demo/e2e/checkout.spec.ts`
- Create: `demo/README.md`

- [ ] **Step 1: Create `demo/e2e/checkout.spec.ts`**

```ts
import { test, expect } from '@introspection/playwright-fixture'

test('shows validation error on invalid card number', async ({ page }) => {
  await page.route('/api/payment/validate', route =>
    route.fulfill({
      status: 422,
      body: JSON.stringify({ errors: [{ field: 'card_number', message: 'Must be 16 digits' }] }),
      headers: { 'content-type': 'application/json' },
    }),
  )
  await page.goto('/checkout')
  await page.fill('[name=card]', '1234')
  await page.click('[type=submit]')
  await expect(page.getByTestId('card-error')).toBeVisible()
})
```

- [ ] **Step 2: Create `demo/README.md`**

```markdown
# Checkout Demo

A small checkout form. One Playwright test is failing.

## Setup

```bash
pnpm install
pnpm exec playwright install chromium
```

## Run the failing test

```bash
pnpm test
```

## Debug

The `introspect` CLI is available after the test runs.

```bash
pnpm exec introspect --help
```
```

- [ ] **Step 3: Commit**

```bash
git add demo/e2e/checkout.spec.ts demo/README.md
git commit -m "feat(demo): add failing Playwright test and README"
```

---

## Task 6: Verify end-to-end

This task has no code to write. Run the demo and confirm the introspect workflow produces useful output.

- [ ] **Step 1: Install and install Playwright**

```bash
cd demo && pnpm install && pnpm exec playwright install chromium
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
pnpm test
```

Expected: 1 test FAILED with timeout on `expect(page.getByTestId('card-error')).toBeVisible()`.

- [ ] **Step 3: Confirm session data was written**

```bash
ls .introspect/
```

Expected: one directory (the session UUID).

- [ ] **Step 4: Run the full investigation path**

```bash
pnpm exec introspect summary
```
Expected: shows a 422 on `POST /api/payment/validate` under "Failed network requests".

```bash
pnpm exec introspect network
```
Expected: table with `POST /api/payment/validate 422`. Note the event ID in the last column.

```bash
pnpm exec introspect body <eventId> --path ".errors"
```
Expected: `[{ "field": "card_number", "message": "Must be 16 digits" }]`

```bash
pnpm exec introspect eval 'events.filter(e => e.type === "plugin.redux.action").map(e => e.data.action.type)'
```
Expected: `["checkout/clearValidationErrors"]` — only the clear action fired before the submit; no `setValidationErrors` after it.

```bash
pnpm exec introspect errors
```
Expected: `TypeError: Cannot read properties of undefined (reading 'errors')` at `handleSubmit`.

```bash
pnpm exec introspect snapshot
```
Expected: shows `response = { status: 422, data: undefined }` in the scope chain at `handleSubmit`.

- [ ] **Step 5: Commit verification (no code changes needed)**

If any command fails or produces unexpected output, fix the relevant app code or attach.ts change and re-run. Once all 6 commands produce the expected output, the demo is done.

```bash
git add -A && git commit -m "feat(demo): verified end-to-end introspect workflow"
```

Only create this commit if you actually had to make changes. If everything worked first try, skip it.
