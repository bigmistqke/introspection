# Debug Rapport: black-canvas demo
**Date:** 2026-04-06
**Demo:** `/Users/puckey/rg/introspection/demos/black-canvas`

---

### Bash: run test to generate trace
**Tool:** `Bash (pnpm test)` — non-CLI tool — need to generate a trace before querying
**Why:** First step — need a trace before I can query anything.
**Output:** 1 failed — `expect(r > 0 || g > 0 || b > 0).toBe(true)` — canvas center pixel is black (RGB all zero) after data load.
**Learned:** The canvas remains black — geometry is not being rendered. The test expected the scene to render non-black pixels after a data load.
**Next:** Run `introspect summary` to get an overview of errors and network activity.

### Bash: introspect summary
**Tool:** `Bash (introspect summary)` — introspect CLI
**Why:** Starting point — gives errors and network failures at a glance.
**Output:** JS errors (1): `TypeError: Cannot read properties of null (reading 'position')` at `SceneLoader.buildGeometry` (line 63) and `SceneLoader.load` (line 59).
**Learned:** There is exactly one JS error. `buildGeometry` tries to read `.position` on a null value. Something is null that shouldn't be — likely a data element from a network response.
**Next:** Run `introspect errors` for the full stack trace, then `introspect snapshot` to see variable scope at crash time.

### Bash: introspect errors
**Tool:** `Bash (introspect errors)` — introspect CLI
**Why:** Need full stack trace to understand the crash path.
**Output:** `TypeError: Cannot read properties of null (reading 'position')` at `buildGeometry` (:63) called from `load` (:59).
**Learned:** The crash is in `buildGeometry(mesh)` when reading `mesh.position` — `mesh` is null. Looking at the code snippet in the snapshot: `const mesh = meshes.find(m => m.name === 'main') || null` — the find returns undefined (no match), falling back to null.
**Next:** Run `introspect snapshot` to confirm `meshes` is empty and see the API response.

### Bash: introspect snapshot
**Tool:** `Bash (introspect snapshot)` — introspect CLI
**Why:** Want to see variable scope at the crash site, especially the `meshes` array content.
**Output:** In `load` frame: `meshes = "Array(0)"`, `nodes = "Array(0)"`, `scene = "Object"`. The `meshes` array is empty — the find returns undefined, mesh is null, and `buildGeometry(null)` crashes on `null.position`.
**Learned:** The API returned a scene with an empty `meshes` array. The code expects a mesh named `'main'` but none exists. This could be because:
  1. The API endpoint returns wrong data (no meshes)
  2. The mesh in the response has a different name than `'main'`
**Next:** Inspect the actual network response body with `introspect network` and `introspect body`.

### Bash: introspect network
**Tool:** `Bash (introspect network)` — introspect CLI
**Why:** Need to find the event ID for the `/api/scene/1` response to fetch its body.
**Output:** Two requests: `GET /` (200, evt-9d152c6d) and `GET /api/scene/1` (200, evt-54c6b96c).
**Learned:** Both requests succeeded with 200. The API call succeeded so the data issue is in the shape of the response.
**Next:** Fetch the body of `evt-54c6b96c` to see what the API actually returned.

### Bash: introspect body evt-54c6b96c
**Tool:** `Bash (introspect body evt-54c6b96c)` — introspect CLI
**Why:** Need to see the actual JSON data returned by `/api/scene/1` to understand why `meshes` is empty.
**Output:** `{ "nodes": [], "geometry": [{ "name": "main", "position": [0, 0.8, -0.7, -0.5, 0.7, -0.5] }] }`
**Learned:** ROOT CAUSE IDENTIFIED. The API response uses the key `"geometry"` for the array, but the code destructures `{ nodes = [], meshes = [] }` — looking for a `"meshes"` key. Since the response has no `"meshes"` key, `meshes` defaults to `[]`, and `meshes.find(m => m.name === 'main')` returns undefined → null → crash.
**Next:** Read `app.html` to locate the destructuring assignment and fix it (change `meshes` to `geometry`, or match whatever key the API actually uses).

### Read: app.html
**Tool:** `Read` — non-CLI tool — needed to locate the exact line to fix after forming hypothesis from trace
**Why:** Hypothesis fully confirmed by trace. Now need to find and fix the destructuring on line 57.
**Output:** Line 57: `const { nodes = [], meshes = [] } = scene` — code looks for `meshes` but API returns `geometry`.
**Learned:** Exact bug confirmed. The fix is to rename `meshes` to `geometry` in the destructuring (or alias: `const { nodes = [], geometry: meshes = [] } = scene`).
**Next:** Edit app.html to fix the destructuring, then run tests to verify.

### Edit: app.html — fix destructuring key mismatch
**Tool:** `Edit` — non-CLI tool — needed to apply the code fix
**Why:** The trace confirmed the bug: code uses `meshes` but API returns `geometry`. Fix uses an alias: `const { nodes = [], geometry: meshes = [] } = scene`.
**Output:** File updated successfully.
**Learned:** N/A — fix applied.
**Next:** Run `pnpm test` to verify the fix.

### Bash: run test to verify fix
**Tool:** `Bash (pnpm test)` — non-CLI tool — verifying fix works
**Why:** Need to confirm the fix makes the test pass.
**Output:** 1 passed (1.4s) — `scene renders after data load` ✓
**Learned:** Fix is correct. The canvas now renders non-black pixels once geometry data is loaded.
**Next:** Revert to buggy state so the demo remains reusable.

### Edit: app.html — revert to buggy state
**Tool:** `Edit` — non-CLI tool — restoring original buggy code for demo reusability
**Why:** Task requires reverting after fix verification.
**Output:** Line 57 restored to `const { nodes = [], meshes = [] } = scene`.
**Learned:** N/A — revert applied.
**Next:** Write investigation report to `.introspect` session directory.

---

## Root Cause Summary

**Bug:** Key mismatch between API response and client-side destructuring.

- **API response** (`/api/scene/1`) returns: `{ "nodes": [], "geometry": [...] }`
- **Client code** (line 57 of `app.html`) destructures: `const { nodes = [], meshes = [] } = scene`
- Since the response has no `meshes` key, `meshes` defaults to `[]`
- `meshes.find(m => m.name === 'main')` returns `undefined`, which the code coerces to `null`
- `buildGeometry(null)` crashes: `TypeError: Cannot read properties of null (reading 'position')`
- WebGL never receives geometry data, so `vertexCount` stays `0`, and the canvas remains black

**Fix:** Change the destructuring to alias the correct key: `const { nodes = [], geometry: meshes = [] } = scene`

**Trace evidence used:**
1. `introspect summary` → identified the JS error and crash location
2. `introspect snapshot` → confirmed `meshes = Array(0)` and revealed the SceneLoader source code showing the destructuring
3. `introspect network` + `introspect body` → confirmed the API returns `geometry`, not `meshes`





