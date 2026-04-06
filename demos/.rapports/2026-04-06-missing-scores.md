# Investigation Rapport: missing-scores (2026-04-06)

## Objective
Debug a failing Playwright test: `leaderboard shows scores`. The test expects `.score-entry` elements to be visible, but none are found.

---

### pnpm test: Run test to generate trace
**Tool:** `pnpm test` — non-CLI tool — needed to generate the trace for introspect to analyze
**Why:** First step — must run the test to produce a trace before investigation can begin.
**Output:**
```
✘  test.spec.ts:12:1 › leaderboard shows scores (5.6s)
Error: expect(locator).toBeVisible() failed
Locator: locator('.score-entry').first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found
```
**Learned:** The test fails because `.score-entry` elements never appear in the DOM. This suggests either: (1) no scores were loaded/rendered, (2) a JS error prevented rendering, (3) a network request failed.
**Next:** Use `introspect summary` and `introspect errors` to check for JS errors and network failures.

---

### introspect list: List available sessions
**Tool:** `introspect list` — introspect CLI
**Why:** Need to identify the latest session ID for the failing test run.
**Output:**
```
404797ce-6c24-4253-9066-fb3d8b124b68      357ms       missing-scores
b2a5a29e-4048-45fa-9c5a-ab8df440c384      363ms       missing-scores
840a6d0e-6fe6-4091-931d-95aa2aef0b1c      360ms       unknown test
```
**Learned:** The latest session is `404797ce` labeled "missing-scores".
**Next:** Check errors and network for the session.

---

### introspect errors: Check for JS errors
**Tool:** `introspect errors` — introspect CLI
**Why:** JS errors could prevent rendering of score entries.
**Output:** `(no JS errors recorded)`
**Learned:** No uncaught JS errors. The problem is not a crash in JS logic.
**Next:** Check network to see if the API call for scores succeeded or failed.

---

### introspect network: Check network requests
**Tool:** `introspect network` — introspect CLI
**Why:** A failed or missing API request could explain why no scores appear.
**Output:**
```
STATUS METHOD  URL                                           EVENT_ID
200   GET     http://demo.test/                                            evt-63438527
200   GET     http://demo.test/api/scores                                  evt-df43e60a
```
**Learned:** Both requests succeeded with 200. The `/api/scores` response was received.
**Next:** Check the body of the `/api/scores` response to see what data was returned.

---

### introspect body evt-df43e60a: Read scores API response body
**Tool:** `introspect body evt-df43e60a` — introspect CLI
**Why:** The API returned 200 but scores aren't rendered — need to check the response shape.
**Output:**
```json
{
  "entries": [
    {"name": "Alice", "points": 980},
    {"name": "Bob", "points": 850},
    {"name": "Carol", "points": 720}
  ]
}
```
**Learned:** The API returns data under an `entries` key. If the JS code expects a different key (e.g., `scores` or the array directly), it would render nothing.
**Next:** Check the DOM snapshot to see what the rendered HTML looks like, and look at timeline events for clues about how the data is consumed.

---

### introspect dom / introspect snapshot: Look for DOM snapshot
**Tool:** `introspect dom` then `introspect snapshot` — introspect CLI
**Why:** Want to see the rendered HTML at test failure time.
**Output:** `(no DOM snapshot available)` / `(no snapshot — session may have ended cleanly, or snapshot was not captured)`
**Learned:** No DOM snapshots were taken. The session ended without a JS error triggering snapshot capture.
**Next:** Read the main page HTML body to see the app's JS code.

---

### introspect body evt-63438527: Read main page HTML
**Tool:** `introspect body evt-63438527` — introspect CLI
**Why:** Need to see the client-side JS code to understand how it processes the API response.
**Output (key excerpt):**
```js
const resp = await fetch('/api/scores')
const data = await resp.json()
const { scores = [] } = data   // <-- destructures key "scores"
```
The API response body uses key `"entries"`, but the code destructures `"scores"`. So `scores` is always `[]`, and the board shows "No scores yet." — no `.score-entry` elements are ever created.
**Learned:** ROOT CAUSE CONFIRMED — key mismatch: API returns `{ entries: [...] }`, JS reads `data.scores` which is `undefined`, defaults to `[]`, renders nothing.
**Next:** Fix the bug in `app.html` by changing `scores` to `entries` in the destructuring.

---

### Edit app.html: Apply the fix
**Tool:** Edit — non-CLI tool — needed to modify the source file to fix the bug
**Why:** Root cause confirmed; need to change `const { scores = [] } = data` to `const { entries = [] } = data` (and update all references to `scores` → `entries` in the same block).
**Output:** File updated successfully.
**Learned:** The fix is minimal — one variable rename on line 19 and the two subsequent usages on lines 21 and 25.
**Next:** Re-run the test to confirm the fix works.

---

### pnpm test (verify fix): Confirm the test passes
**Tool:** `pnpm test` — non-CLI tool — needed to run the Playwright test suite
**Why:** Verify the fix resolves the failure before reverting.
**Output:** `✓  1 test.spec.ts:12:1 › leaderboard shows scores (638ms)` — 1 passed (1.2s)
**Learned:** Fix confirmed. The `.score-entry` elements are now rendered correctly.
**Next:** Revert `app.html` to the original buggy state so the demo remains reusable.

---

### Edit app.html: Revert to buggy state
**Tool:** Edit — non-CLI tool — needed to restore the intentional bug for demo reusability
**Why:** The task requires reverting after confirming the fix, so the demo stays in its buggy state for future demonstrations.
**Output:** File restored — `const { scores = [] } = data` back in place.
**Learned:** Demo is back to its broken state.
**Next:** Write final summary.

---

## Summary

**Root cause:** Key mismatch between the API response and the client-side JavaScript.

- The `/api/scores` endpoint returns `{ "entries": [...] }`
- The client JS destructures `const { scores = [] } = data` — key `scores` does not exist in the response
- `scores` defaults to `[]`, which causes the app to render "No scores yet." and produce zero `.score-entry` elements
- The test assertion `expect(page.locator('.score-entry').first()).toBeVisible()` times out waiting for elements that are never created

**Fix:** Change `const { scores = [] } = data` to `const { entries = [] } = data` and update the two subsequent uses of `scores` to `entries` in `app.html` line 19–25.

**Evidence chain:**
1. `introspect network` — both requests returned 200, no network failures
2. `introspect errors` — no JS exceptions thrown
3. `introspect body evt-df43e60a` — API response has key `entries`, not `scores`
4. `introspect body evt-63438527` — page HTML shows JS reads `data.scores`, which is `undefined`

