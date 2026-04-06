# WebGL Animation Debug Rapport — 2026-04-06

## Initial test run

**Command:** `pnpm test` in `/Users/puckey/rg/introspection/demos/webgl-animation`

**Why:** Running the test first to see the failure mode and generate a trace.

**Output:** The browser crashed with SIGSEGV (signal 11). The test "animation plays at correct speed" failed immediately with "browserType.launch: Target page, context or browser has been closed". The browser process died before completing any work.

**Decided:** The SIGSEGV is likely caused by a bad WebGL shader or invalid WebGL usage that triggers a GPU crash in swiftshader. Check whether a trace was generated despite the crash, then use introspect summary to look for JS errors or other clues.

---

## Introspect trace investigation

**Command:** `introspect list`

**Why:** Need to see what sessions were captured despite the crash.

**Output:** 4 sessions found. The latest is "ongoing" (f46a6c26), and the most recent completed one is 001cb9e7.

**Decided:** Run summary on the most recent completed session.

---

**Command:** `introspect summary`

**Why:** Get plain-language overview of what happened.

**Output:** `Session: "unknown test" (3293ms)` — very minimal, no errors, no network failures mentioned.

**Decided:** Look at the timeline and errors.

---

**Command:** `introspect timeline` + `introspect errors`

**Why:** Timeline gives full event sequence; errors catches any JS problems.

**Output (timeline):**
- network.request GET http://demo.test/
- webgl.context-created (at 74ms)
- asset body saved
- network.response 200 http://demo.test/
- webgl-state saved (at 3279ms, 0 uniforms, 0 bound textures)
- webgl-canvas PNG saved

**Output (errors):** `(no JS errors recorded)`

**Key observations:**
- WebGL context was created (at 74ms)
- But `uniformCount: 0` — no uniforms were set. This means the shader never ran or was never set up.
- `boundTextureCount: 0` — no textures bound
- No draw events appear in the timeline at all
- The session ran for ~3 seconds but nothing animated

**Decided:** Check for draw-arrays/draw-elements events to see if any rendering happened. Also check the webgl-state JSON directly for more details.

---

**Command:** `introspect events --type webgl.draw-arrays,webgl.draw-elements` + `introspect eval 'events.filter(e => e.type.startsWith("webgl"))'`

**Why:** No draw events appeared in the timeline. Checking explicitly to confirm.

**Output:** No draw events. Only `webgl.context-created` at 74ms. WebGL state shows `uniforms: {}`, `textures: []` — the shader never ran.

**Observation:** The most recent session (001cb9e7) seems to show a working-ish state (canvas is a solid blue), but the "ongoing" session (f46a6c26) is the one that actually crashed. The SIGSEGV likely came from the most recent test run. Let me check the ongoing session.

---

**Command:** `introspect summary --session f46a6c26-0dc9-47bc-9899-782691ce5db7`

**Why:** The "ongoing" session is the one that didn't finalize due to the crash — it's probably the most recent test run.

**Output:**
```
Session: "unknown test" (ongoing)

JS errors (1):
  TypeError: Cannot read properties of undefined (reading 'now')
    at AnimationLoop.tick (http://demo.test/:32:33)
    at http://demo.test/:43:42
```

**Finding:** There IS a JS error. `this.clock` is `undefined` when `tick()` runs. The error is at line 32 where `this.clock.now()` is called.

---

**Command:** `introspect snapshot --session f46a6c26-0dc9-47bc-9899-782691ce5db7 --filter 'snapshot.trigger === "js.error"'`

**Why:** Need the variable scope at crash time to understand why `this.clock` is undefined.

**Output highlights:**
- `positionAttr = -1` — the position attribute was not found in the shader (linked program)
- `loop = "AnimationLoop"` — the loop object exists but `clock` was somehow undefined at crash time

**Key clue:** `positionAttr = -1` means `gl.getAttribLocation(program, 'position')` returned `-1`. This suggests the attribute name `position` wasn't found in the linked program. However, the vertex shader clearly declares `attribute vec2 position`. This could indicate a shader compilation or linking failure, but the real crash cause is the `this.clock` undefined error.

---

**Command:** Reading the body asset `839fb162.body.json` from the crashed session.

**Why:** Need to see the actual app.html source loaded in the crashed session to understand the full code.

**Output (key finding):** At the very end of the script block:
```javascript
setTimeout(() => { loop.clock = undefined }, 2000)
```

This line deliberately sets `loop.clock` to `undefined` after 2 seconds. When `tick()` runs after that, `this.clock.now()` throws `TypeError: Cannot read properties of undefined (reading 'now')`.

**Root cause confirmed:** The bug is `setTimeout(() => { loop.clock = undefined }, 2000)` at the bottom of the script. This is an intentional sabotage that breaks the animation loop after 2 seconds by destroying the clock reference.

**Fix:** Remove that `setTimeout` line.

---

