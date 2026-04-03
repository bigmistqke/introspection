# Demo: Checkout Validation Bug

## Goal

A self-contained demo app that presents a failing Playwright test. A fresh agent — with no knowledge of the introspection library or the scenario — should be able to use the `introspect` CLI to discover and explain the root cause.

## Purpose

Verify that the core introspect CLI workflow is discoverable and sufficient to debug a real bug without documentation or prior context.

## Location

`demo/` at the monorepo root, added to `pnpm-workspace.yaml`. Depends on `@introspection/vite`, `@introspection/playwright-fixture`, and `@introspection/plugin-redux` via `workspace:*`. Agent is given `demo/` as its working directory.

---

## App

A minimal checkout form. The user enters a card number and submits. If the card number is invalid the server returns a 422 with a structured error body. The UI should display the error message below the field.

**Tech stack:** Vite + React + Redux Toolkit + React Router + `@introspection/plugin-redux`

---

## File Map

| File | Purpose |
|------|---------|
| `demo/package.json` | Workspace package; scripts: `dev`, `test`, `build` |
| `demo/vite.config.ts` | Vite config with `introspection()` plugin only |
| `demo/playwright.config.ts` | Playwright config; `baseURL: http://localhost:5173`; `webServer` block to auto-start Vite |
| `demo/src/main.tsx` | React entry point |
| `demo/src/App.tsx` | Router: `/checkout` → `CheckoutPage`, `/success` → `SuccessPage` |
| `demo/src/store/index.ts` | Redux store; `createReduxPlugin(store)` from `@introspection/plugin-redux` wired as middleware |
| `demo/src/store/checkoutSlice.ts` | `validationErrors: string[] \| null`, `setValidationErrors` action |
| `demo/src/api/client.ts` | Fetch wrapper — **the bug lives here** |
| `demo/src/pages/CheckoutPage.tsx` | Card number field, submit button, error display `[data-testid=card-error]` |
| `demo/src/pages/SuccessPage.tsx` | Shown on successful payment |
| `demo/e2e/checkout.spec.ts` | The failing Playwright test — imports `test`/`expect` from `@introspection/playwright-fixture` |
| `demo/README.md` | Minimal — no hints about the bug or CLI workflow |

---

## The Bug

`api/client.ts` only parses the response body on 2xx responses:

```ts
async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.ok) return { status: res.status, data: await res.json() }
  return { status: res.status, data: undefined }   // ← bug: body not parsed on 4xx
}
```

`CheckoutPage.tsx` passes the response to a handler:

```ts
async function handleSubmit() {
  const response = await api.post('/api/payment/validate', { card })
  dispatch(setValidationErrors(response.data.errors))  // throws: data is undefined
}
```

`response.data` is `undefined` on a 422. Accessing `.errors` on it throws `TypeError: Cannot read properties of undefined (reading 'errors')`. The throw propagates as an unhandled promise rejection — no `.catch()`, no Redux action dispatched, no error message rendered.

---

## The Failing Test

`e2e/checkout.spec.ts` imports `test`/`expect` from `@introspection/playwright-fixture` — this is what wires in the introspection fixture automatically (the fixture runs with `auto: true` inside the package):

```ts
import { test, expect } from '@introspection/playwright-fixture'

test('shows validation error on invalid card number', async ({ page }) => {
  await page.route('/api/payment/validate', route =>
    route.fulfill({
      status: 422,
      body: JSON.stringify({ errors: [{ field: 'card_number', message: 'Must be 16 digits' }] }),
      headers: { 'content-type': 'application/json' },
    })
  )
  await page.goto('/checkout')
  await page.fill('[name=card]', '1234')
  await page.click('[type=submit]')
  await expect(page.getByTestId('card-error')).toBeVisible()
})
```

The test fails because `[data-testid=card-error]` never becomes visible — the validation error is never dispatched to the store.

---

## Playwright Config

`playwright.config.ts` must include a `webServer` block so the agent can run `pnpm test` without manually starting the dev server first:

```ts
export default defineConfig({
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
})
```

---

## Expected Investigation Path

A well-functioning CLI workflow leads the agent through these steps:

1. `pnpm exec introspect summary` — sees a 422 on POST /api/payment/validate listed under failed requests; nothing else happened in the UI
2. `pnpm exec introspect network` — table view shows the 422; **the event ID visible here is needed for step 3**
3. `pnpm exec introspect body <eventId> --path ".errors"` — reads the structured error body from the server response
4. `pnpm exec introspect eval 'events.filter(e => e.type === "plugin.redux.action").slice(-5)'` — returns empty (or only pre-submit actions); no Redux actions fired after the 422
5. `pnpm exec introspect errors` — `TypeError: Cannot read properties of undefined (reading 'errors')` at `handleSubmit` in `CheckoutPage.tsx`
6. `pnpm exec introspect snapshot` — `response = { status: 422, data: undefined }` at the throw site

Root cause surfaces at step 5–6: the fetch wrapper doesn't parse the body on 4xx, so `response.data` is `undefined`.

---

## README (full content)

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

No hints about the bug or the investigation workflow — the agent discovers both.

---

## Notes for implementer

- `@introspection/playwright-fixture` currently imports `TestResult` from `@introspection/types`, which was removed in the session-directory refactor. Update the fixture to use the local `DetachResult` pattern (same as `attach.ts`) before wiring it into the demo.
- `createReduxPlugin(store)` is registered as Redux middleware in `src/store/index.ts`, not as a Vite plugin. The Vite config only needs `introspection()`.
- Session data lands in `demo/.introspect/` after `pnpm test`. The CLI reads from there by default.
