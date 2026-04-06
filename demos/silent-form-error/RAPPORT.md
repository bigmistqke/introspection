# RAPPORT — Debugging Log

## Initial code review

**Why:** Before running anything, I read both `app.html` and `test.spec.ts` to understand the intended behavior and the test setup.

**What the code tells me:**

- `test.spec.ts` routes `POST /api/payment/validate` to return HTTP 422 with body `{ errors: [{ field: 'card_number', message: 'Must be 16 digits' }] }`.
- The test expects `[data-testid="card-error"]` to become visible after clicking submit.
- `app.html` defines `handlePaymentResponse(response)` which reads `response.data.errors`.
- In `apiPost`, when `response.ok` is false (which it will be for a 422), the function returns `{ data: undefined, status: response.status }` — note: `data` is `undefined`.
- So `handlePaymentResponse` will try `response.data.errors` where `response.data` is `undefined`, which throws a TypeError.
- The `.catch(() => {})` in the submit handler silently swallows this error, so the card-error element never becomes visible.

**Hypothesis:** The bug is that `apiPost` discards the response body on non-OK responses, returning `data: undefined`. When `handlePaymentResponse` tries to access `response.data.errors`, it throws a TypeError that is silently caught, leaving the error element hidden.

**Next step:** Run the test to generate a trace, then use `introspect` to confirm this hypothesis.

---

## Running the test

**Why:** Need to generate the trace for `introspect` to analyze, and confirm the test fails.

**What the output told me:** Test fails with `toBeVisible` timing out — the `card-error` element remains hidden. This matches the hypothesis.

**Next step:** Run `introspect summary` to get a plain-language overview.

---

## introspect summary

**Why:** Start at the top of the decision tree as instructed.

**What the output told me:**
- One failed network request: `422 http://demo.test/api/payment/validate`
- No session label (test didn't pass a `testTitle` option... wait, it passed `label: 'silent-form-error'` — the session may have been left ongoing because `handle.detach()` was never reached due to the test failure)

**Decision:** Summary shows a 422. Next step: check for JS errors (decision tree says "JS error found → get the stack and scope").

---

## introspect errors

**Why:** Decision tree says if a JS error is found, get the stack and scope.

**What the output told me:** "no JS errors recorded" — which is interesting. The TypeError from `response.data.errors` where `data` is `undefined` was thrown inside a `.then()` callback, and `.catch(() => {})` silently swallowed it. CDP's uncaught error listener never fired because the error was caught.

**Decision:** No JS errors recorded because they were swallowed. Let me look at the network response body to confirm the 422 did carry the error payload.

---

## introspect network + body inspection

**Why:** Needed to confirm what the server actually returned in the 422 response.

**What the output told me:**
- The 422 POST to `/api/payment/validate` was recorded.
- The response body asset contains: `{"errors":[{"field":"card_number","message":"Must be 16 digits"}]}`
- So the API did return the errors array — the data was available, but `apiPost` discarded it.

**Root cause confirmed:** In `apiPost`, the non-OK branch returns `{ data: undefined, status: response.status }` without parsing the response body. Then `handlePaymentResponse` tries `response.data.errors` where `response.data` is `undefined`, throwing a TypeError. This error is silently swallowed by `.catch(() => {})`, so the card-error div is never shown.

**Fix:** In `apiPost`, always parse the response body with `response.json()`, not just on OK responses. Return `{ data: await response.json(), status: response.status }` for both branches.

**Next step:** Apply the fix to `app.html`.

---

## Applying the fix

**Why:** Root cause is clear — `apiPost` discards the body on non-OK responses. Fix: always call `response.json()` regardless of `response.ok`.

**What I changed:** Removed the `if (response.ok)` branch and replaced both branches with a single `return { data: await response.json(), status: response.status }`. This way, the 422 response body (which contains `{ errors: [...] }`) is parsed and passed to `handlePaymentResponse`, which can then display the error message.

**Result:** `pnpm test` now passes — 1 passed in 1.1s. The card-error div becomes visible with "Must be 16 digits".


