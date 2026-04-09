# Rapport log — webgl-animation debugging session
**Date:** 2026-04-06

---

## Step 1: Run the test

**Why:** Starting point — need to generate a trace and see the failure message.

**Command:** `pnpm test`

**Output:**
```
Error: expect(received).not.toEqual(expected)
Expected: not {"data": [137, 80, 78, 71, ...], "type": "Buffer"}
  at test.spec.ts:37:22
```

**What it told me:** The test takes two screenshots (`frame1`, `frame2`) and asserts they are different (animation should advance). They are identical — the canvas is frozen. The animation is not progressing.

**Next:** Run `introspect summary` to get the plain-language overview of the session.

---

## Step 2: introspect summary

**Why:** The summary command is the prescribed starting point — it gives JS errors, network failures, and session label at a glance.

**Command:** `node .../cli/dist/index.js summary --dir .introspect`

**Output:**
```
Session: "unknown test" (ongoing)

JS errors (1):
  TypeError: Cannot read properties of undefined (reading 'now')
    at AnimationLoop.tick (http://demo.test/:32:33)
    at http://demo.test/:43:42
```

**What it told me:** There is exactly one JS error. `AnimationLoop.tick` crashes at line 32 trying to call `.now()` on something that is `undefined`. In animation code line 32 likely reads `this.clock.now()` — meaning `this.clock` is `undefined`.

**Next:** Confirm the stack with `introspect errors` and look for scope locals with `introspect snapshot`.

---

## Step 3: introspect errors + snapshot

**Why:** `errors` gives the full source-mapped stack; `snapshot` might show what variables held what values at crash time.

**Command:** `introspect errors` then `introspect snapshot --filter 'snapshot.trigger === "js.error"'`

**Output:**
- `errors`: confirmed stack — `tick` at line 32, called from anonymous at line 43.
- `snapshot`: "(no snapshot)" — scope locals were not captured for this error.

**What it told me:** The stack alone is enough. Line 32 calls `.now()` on a property that is `undefined`. Line 43 is `requestAnimationFrame(() => this.tick())` — the ongoing RAF loop.

**Next:** Check the timeline and WebGL events to understand whether the animation ever produced any frames.

---

## Step 4: introspect timeline

**Why:** Want to see the full event sequence — specifically whether any WebGL draw calls happened and when the error fired relative to the animation start.

**Command:** `introspect timeline`

**Output:**
```
[~0ms]   network.request GET http://demo.test/
[92ms]   webgl.context-created
[183ms]  asset body
[~0ms]   network.response 200 http://demo.test/
[very large ts]  js.error TypeError: Cannot read properties of undefined (reading 'now')
[3004ms] snapshot
[3005ms] webgl-state asset
[3005ms] webgl-canvas PNG
```

**What it told me:** The WebGL context was created at 92ms but no `webgl.uniform` or `webgl.draw-arrays` events appear at all — the animation never successfully drew a single frame after the error began firing. The error timestamp was anomalously large (a CDP monotonic clock artifact), but the error itself was real and caused the canvas to stop updating.

**Next:** Confirm no draw calls with a targeted eval, then form a hypothesis and read the source.

---

## Step 5: introspect eval for webgl events

**Why:** Confirm zero draw calls definitively before reading source.

**Command:** `introspect eval 'events.filter(e => e.type.startsWith("webgl"))'`

**Output:** Only `webgl.context-created`. No uniforms, no draws.

**What it told me:** The animation loop crashed before producing any renders (or crashed so early the test screenshot captures happened during the freeze).

**Hypothesis (confident):** Something intentionally or accidentally sets `this.clock` to `undefined` after the `AnimationLoop` is constructed. The constructor sets `this.clock = new Clock()` but something later nulls it.

---

## Step 6: Read app.html (hypothesis confirmed)

**Why:** Confident enough to read source and verify.

**Finding:** Lines 98–100:
```js
setTimeout(() => {
  loop.clock = undefined
}, 2000)
```

This deliberately destroys the clock 2 seconds after page load. The test waits between screenshots and both screenshots land while the clock is `undefined`, so every RAF tick throws and the canvas never updates.

---

## Step 7: Fix

**Action:** Removed the `setTimeout` block (lines 98–100) from `app.html`.

---

## Step 8: Verify

**Command:** `pnpm test`

**Output:** `1 passed (3.5s)` — test green.

---

## Summary

**Root cause:** A `setTimeout(() => { loop.clock = undefined }, 2000)` in `app.html` deliberately nulls the `Clock` instance, causing `AnimationLoop.tick` to throw `TypeError: Cannot read properties of undefined (reading 'now')` on every subsequent RAF tick. The canvas freezes, making both test screenshots identical.

**Fix:** Remove the `setTimeout` block.

**Evidence trail:** `introspect summary` revealed the JS error in under 10 seconds. The stack (`AnimationLoop.tick` → `.now()` on `undefined`) pointed unambiguously at `this.clock` being null. WebGL event absence confirmed the canvas was frozen throughout the test.
