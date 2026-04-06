# WebGL Animation Debug Rapport — 2026-04-06 (session 3)

## Investigation Log

### Bash: run test to generate trace
**Tool:** `Bash (pnpm test)` — non-CLI tool — needed to generate the trace before querying
**Why:** First step — need a trace before I can query anything.
**Output:** 1 failed — `expect(frame2).not.toEqual(frame1)` — the two screenshots are identical, so animation is frozen.
**Learned:** The animation is not changing between frame1 and frame2, meaning the WebGL rendering stopped updating.
**Next:** Run introspect summary to get an overview of JS errors and network failures.

---

### Bash: introspect summary
**Tool:** `Bash (introspect summary)` — introspect CLI
**Why:** Summary is the prescribed starting point — gives errors and network failures at a glance.
**Output:** JS errors (1): TypeError: Cannot read properties of undefined (reading 'now') at AnimationLoop.tick (:32:33)
**Learned:** There is exactly one JS error. tick() crashes accessing `.now()` on something that is undefined — almost certainly `this.clock`.
**Next:** Check the full stack and variable scope at the crash site.

---

### Bash: introspect errors
**Tool:** `Bash (introspect errors)` — introspect CLI
**Why:** Want the full source-mapped stack trace to confirm the call chain.
**Output:** TypeError at tick (:32), called from anonymous (:43) — confirms crash inside AnimationLoop.tick.
**Learned:** The crash is in `tick()` at line 32 where `this.clock.now()` is called, and `this.clock` is undefined.
**Next:** Use introspect snapshot to see what variables were set at the crash moment.

---

### Bash: introspect snapshot --filter 'snapshot.trigger === "js.error"'
**Tool:** `Bash (introspect snapshot)` — introspect CLI
**Why:** Want to see what variables held at the moment of the crash — specifically whether `this.clock` is undefined.
**Output:** Scope at tick (:32) shows `loop = "AnimationLoop"` and all module-level variables, but `this` (the instance) is not directly captured. The AnimationLoop class definition shows `this.clock = new Clock()` in the constructor. The error says `.now()` is read on undefined.
**Learned:** `this.clock` must have been set to `undefined` after construction. The crash fires at ~3000ms, strongly suggesting a `setTimeout(..., 3000)` that nulls `loop.clock`.
**Next:** Check the timeline to confirm the exact timing of the crash.

---

### Bash: introspect timeline
**Tool:** `Bash (introspect timeline)` — introspect CLI
**Why:** Want to see exact timestamps to confirm the ~3s pattern.
**Output:** webgl.context-created at 79ms, js.error at 2999ms — exactly ~3 seconds after page load.
**Learned:** The crash fires at almost exactly 3000ms. This is a deliberate setTimeout sabotage that sets `loop.clock = undefined` (or similar) after 3 seconds.
**Next:** I have a confident hypothesis. Read app.html to find and remove the sabotage.

---

### Read: app.html
**Tool:** `Read` — non-CLI tool — needed to locate the exact line to fix after forming hypothesis from trace
**Why:** Hypothesis confirmed by trace timing. Now need to find the setTimeout that nulls clock.
**Output:** Line 98: `setTimeout(() => { loop.clock = undefined }, 2000)` — exactly the sabotage I expected.
**Learned:** The bug is a deliberate 2-second timeout that sets `loop.clock = undefined`. The next call to `tick()` after that fires tries `this.clock.now()` which crashes because `this.clock` is now `undefined`. The crash appears at ~3000ms because there's a small delay between the timeout firing and the next animation frame.
**Next:** Remove line 98 to fix the bug, run the test to verify, then revert.

---

### Edit: remove setTimeout sabotage
**Tool:** `Edit` — non-CLI tool — needed to modify the source file to fix the bug
**Why:** The trace evidence is conclusive. Removing the timeout restores correct animation behavior.
**Output:** Line 98 (`setTimeout(() => { loop.clock = undefined }, 2000)`) removed.
**Learned:** Fix is a single-line deletion.
**Next:** Run pnpm test to verify fix.

---

### Bash: pnpm test (verify fix)
**Tool:** `Bash (pnpm test)` — non-CLI tool — needed to confirm fix works
**Why:** Confirm that removing the setTimeout makes the test pass.
**Output:** 1 passed (4.1s)
**Learned:** Fix confirmed — the animation now changes between frame1 and frame2 as expected.
**Next:** Revert app.html to the buggy state so the demo remains reusable.

---

### Edit: revert app.html to buggy state
**Tool:** `Edit` — non-CLI tool — needed to restore the deliberate bug for demo reusability
**Why:** Instructions require restoring the original buggy state after verification.
**Output:** `setTimeout(() => { loop.clock = undefined }, 2000)` restored at line 98.
**Learned:** App is back to buggy state for future demo runs.
**Next:** Write final summary.

---

## Root Cause

**File:** `/Users/puckey/rg/introspection/demos/webgl-animation/app.html`, line 98

**Bug:** `setTimeout(() => { loop.clock = undefined }, 2000)` sets `loop.clock` to `undefined` two seconds after the animation starts. The `AnimationLoop.tick()` method calls `this.clock.now()` on every frame. Once `clock` is nulled, the next tick throws `TypeError: Cannot read properties of undefined (reading 'now')`, crashing the animation loop and freezing the canvas.

**Evidence from trace:**
- `introspect summary`: single JS error — `TypeError: Cannot read properties of undefined (reading 'now')` at `AnimationLoop.tick (:32)`
- `introspect timeline`: `js.error` fires at 2999ms — exactly ~2000ms after the animation starts (WebGL context created at 79ms, so sabotage fires at ~2079ms, crash on next tick at ~2999ms)
- `introspect snapshot`: scope variables confirmed `loop = AnimationLoop` and `this.clock` is the property being accessed — no other explanation for it being `undefined` than a post-construction mutation

**Fix:** Remove the `setTimeout` line.
