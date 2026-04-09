---
name: create-ctf
description: Use when creating a new CTF challenge with a hidden bug that an agent should discover using the introspect CLI
---

# Create CTF

Creates a self-contained Playwright challenge with a deliberate hidden bug, verifies the introspect trace has the signals needed to find it, then hands off to the run-ctf skill.

## Steps

### 1. Design the challenge

Determine the bug scenario from the user's message. If unclear, pick an unused scenario from `ROLE_PLAY.md`. The bug must:

- Be discoverable **entirely from `introspect` CLI output** — no source reading needed to form a hypothesis
- Map to at least one of these trace signals: `introspect events --type js.error`, `introspect assets`, `introspect events --type webgl.*`
- Cause a Playwright test assertion to fail in a way that doesn't reveal the root cause

Choose a short kebab-case name for `ctf/<name>/`.

### 2. Create the files

**`ctf/<name>/app.html`**
- Self-contained single-file browser app (no bundler)
- The bug is a logical defect in the JS — wrong key, off-by-one, null not checked, premature mutation, etc.
- **No comments that name, hint at, or describe the bug**
- Variable and function names must be natural — nothing like `isBuggy`, `WRONG_KEY`, `brokenFetch`
- The bug should cause either: an uncaught/unhandled JS error, a network response body mismatch, or a WebGL render failure

**`ctf/<name>/test.spec.ts`**
- Uses `@introspection/playwright` `attach()` + `handle.detach()`
- Routes the app HTML and any API responses via `page.route()` — no dev server
- Uses `plugin-webgl` if the bug involves WebGL
- The assertion tests visible behavior (pixel color, DOM element visibility, animation progress) — not internals
- Imports follow the ESM `__dirname` pattern from existing challenges

**`ctf/<name>/playwright.config.ts`**
- Copy from `ctf/webgl-animation/playwright.config.ts` if WebGL is needed, otherwise minimal headless config

**`ctf/<name>/package.json`**
- `devDependencies`: `@introspection/playwright`, `introspect`, `@playwright/test`, `typescript` — all `workspace:*` or `^version`
- Add `@introspection/plugin-webgl` if WebGL is used

### 3. Install and run

```bash
pnpm install
cd ctf/<name> && pnpm test
```

The test must **fail**. If it passes, the bug isn't effective — redesign.

### 4. Verify trace signals

Using `pnpm exec introspect --dir .introspect`, confirm the trace contains the evidence an agent needs:

```bash
pnpm exec introspect summary --dir .introspect
pnpm exec introspect events --type js.error --dir .introspect
pnpm exec introspect assets --kind scopes --dir .introspect
pnpm exec introspect events --type network.response --dir .introspect
pnpm exec introspect assets --kind body --dir .introspect
pnpm exec introspect events --type webgl.draw-arrays --dir .introspect
```

**Required signal checklist — at least one must be true:**
- [ ] `summary` shows a JS error with a useful message and stack
- [ ] `assets --kind scopes` shows a variable with the wrong value (null, undefined, wrong type, wrong key)
- [ ] `assets --kind body` shows an API response whose structure differs from what the code expects
- [ ] `events --type webgl.draw-arrays` events have `count: 0` or are absent when they should be present

If the trace lacks sufficient signals, strengthen the bug or adjust the app so the evidence surfaces.

### 5. Verify the reasoning chain

Walk through each introspect command an agent would run and confirm the output at each step logically leads to the next. You are not solving the bug — you are checking that the evidence chain is complete and unambiguous.

For each step, verify:

1. **`introspect summary`** — does it surface the right signal (JS error / network failure / frozen animation)? Would an agent know where to look next?
2. **`introspect events --type js.error`** — does the output name the right function and property? Is the stack trace useful?
3. **`introspect assets --kind scopes`** — do the scope locals show the wrong value (null, undefined, wrong type)? Is the offending variable visible?
4. **`introspect assets --kind body`** (if network bug) — does the response body show the key the code expected is missing or named differently?

After running each command, ask: *could an agent reading only this output form a correct hypothesis without reading source?* If any step produces output that is empty, ambiguous, or points in the wrong direction, fix the challenge and re-run from step 3.

The goal is that the chain `summary → events → assets` is sufficient for a confident root cause — no step missing, no dead ends.

### 6. Revert if needed

If you edited `app.html` during verification (e.g. to strengthen a signal), restore the original buggy code before handing off.

### 7. Hand off to run-ctf

Call the `run-ctf` skill with the challenge directory as the argument.

---

## What makes a good introspection bug

| Signal used | Bug pattern | Example |
|---|---|---|
| `events --type js.error` + `assets --kind scopes` | Wrong key access | `scene.meshes` when API returns `scene.geometry` |
| `events --type js.error` + `assets --kind scopes` | Post-construction mutation | `setTimeout(() => { obj.dep = undefined }, N)` |
| `assets --kind body` | 4xx response body discarded | `if (ok) return { data: json }` else `return { data: undefined }` |
| `events --type webgl.*` | Empty vertex buffer | `drawArrays` with `count: 0` after failed geometry load |

## What to avoid

- Comments, variable names, or log messages that name or describe the bug
- Bugs requiring reading source code to form the initial hypothesis
- Bugs that make `introspect events --type js.error` empty AND leave no other signal (fully silent failures)
- Over-engineered apps — simpler is better, the bug is the point
