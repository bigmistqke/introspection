# Design: `@introspection/plugin-focus-element`

> **Status:** landed (2026-05-08) · plan: `docs/superpowers/plans/2026-05-08-plugin-focus-element.md`

## Goal

A plugin that records every focus transition during a trace — useful both for assertion debugging ("focus didn't land where I expected") and for full focus-journey tracing (tab order, modal traps, route changes that restore focus, accessibility review).

## Non-goals

- Classifying the cause of every focus change. We only claim **`programmatic`** when we can prove it (the `.focus()` patch fired). Otherwise we say `unknown` and let the unified trace timeline (clicks, keydowns, navigation from other plugins) explain why focus moved.
- Cross-origin iframe focus tracking. Same-origin coverage only; cross-origin frames appear once as the `<iframe>` element, then go silent.
- Source-map resolution of programmatic-call stacks. Raw stacks are emitted; the CLI/UI resolves lazily.

## Package

- Path: `plugins/plugin-focus-element`
- Public factory: `focusElement(options?: FocusElementOptions): IntrospectionPlugin`

## Event type

A single new event registered in `packages/types/src/index.ts`:

```ts
export interface FocusChangedEvent extends BaseEvent {
  type: 'focus.changed'
  metadata: {
    target: ElementInfo | null      // null when focus leaves the document
    previous: ElementInfo | null
    origin?: string                 // location.origin of the emitting frame; omitted in main frame
  } & FocusCause
}

export type FocusCause =
  | { cause: 'programmatic'; callSite: string }   // raw stack of the .focus() / .blur() call site
  | { cause: 'unknown' }                          // user input, autofocus, tabindex on removal, etc.

export interface ElementInfo {
  tag: string                       // lowercase
  id: string | null
  classList: string[]
  testid: string | null             // data-testid
  role: string | null               // computed role (or [role] attr fallback)
  accessibleName: string | null     // aria-label / labelled-by / text
  text: string | null               // innerText, truncated to 120 chars
  selector: string                  // CSS path (best-effort, scoped to this frame)
  shadowPath: string[] | null       // host selectors deepest-last, null if not in a shadow tree
  backendNodeId: number | null      // populated when CDP roundtrip is cheap; otherwise null
}
```

`TraceEventMap` is augmented in-repo via direct edit; no declaration merging needed.

## Mechanics

The plugin is **browser-side only** — no CDP subscriptions. The injected script:

1. **Initial focus snapshot.** On install and on `pageshow`, captures `document.activeElement` and emits `focus.changed` with `previous: null`.

2. **Focus listener.** Adds a single `focusin` listener on `document` (capturing phase). `focusin` already fires for both "focus moved here from elsewhere" and "focus arrived from `null`" — listening to both `focusin` and `focusout` would double-emit per transition. To catch the **focus-leaves-document** case (no `focusin` fires), add a `focusout` listener that emits *only* when `event.relatedTarget === null` and the post-microtask `document.activeElement` is `body` or `null`. On each emission:
   - Resolves the *real* focused element by walking `document.activeElement.shadowRoot?.activeElement` recursively until we hit a non-shadow-host or `null`.
   - Builds an `ElementInfo` for both `previous` (cached from the prior emission) and `target`.
   - Reads the `programmatic` flag (see step 3); emits the event.

3. **`.focus()` / `.blur()` patch.** At install:
   ```js
   const realFocus = HTMLElement.prototype.focus
   HTMLElement.prototype.focus = function(...args) {
     pendingProgrammatic = { stack: new Error().stack ?? '' }
     try { return realFocus.apply(this, args) } finally { pendingProgrammatic = null }
   }
   ```
   Same for `.blur()`. The `focusin` listener reads `pendingProgrammatic` synchronously — since `.focus()` dispatches focus events synchronously before returning, the flag is guaranteed to be set when the listener runs. No timing heuristics.

4. **Element identification.** `ElementInfo` is built by:
   - `role` — prefer `[role]` attribute; fall back to a small implicit-role table for common tags (`button`, `a[href]`, `input[type=…]`, `textarea`, `select`, etc.). Computed-role via accessibility tree is *not* attempted browser-side.
   - `accessibleName` — `aria-label` → `aria-labelledby` resolved → associated `<label>` for inputs → `innerText` truncated. Best-effort; mirrors how Playwright locators read.
   - `selector` — CSS path walking up parent chain until an element with a unique `id` or until `body`, using `:nth-child` segments where needed. Bounded depth.
   - `shadowPath` — built during the `activeElement` walk in step 2.
   - `backendNodeId` — `null` for v1 (would require a CDP roundtrip per event; not worth the cost).

5. **Per-frame, frame-correct.** Each injected instance handles only its own frame: walks its own `activeElement` chain (shadow DOM only, not iframe contents). Sets `origin: location.origin` on emitted events when running in a sub-frame; omitted for the main frame so single-frame traces stay clean. If the framework injects the plugin into multiple frames, each emits independently.

## Options

```ts
export interface FocusElementOptions {
  origins?: (string | RegExp)[]   // if set, plugin no-ops in frames whose origin doesn't match
  verbose?: boolean               // debug logging via createDebug
}
```

`origins` is implemented inside the script: at top of the IIFE, `if (!matches(location.origin, options.origins)) return`. String entries are exact-match; RegExp entries `.test()` against `location.origin`. When omitted, runs in every frame the framework injects into.

A framework-level `origins` option (applying to all script-injecting plugins) is parked at `docs/superpowers/plans/2026-05-08-origins-option.md`. The per-plugin override designed here will become the override layer once that ships.

## File layout

```
plugins/plugin-focus-element/
  package.json
  tsconfig.json
  README.md
  playwright.config.ts
  src/
    index.ts            # factory + IntrospectionPlugin definition
    script.ts           # browser-side IIFE source (string-built at compile time)
    element-info.ts     # ElementInfo builder (also used in tests)
  test/
    fixtures/
      simple.html
      shadow.html
      iframe-same-origin.html
      modal-trap.html
    focus.spec.ts
```

`src/script.ts` exports a string template; `src/index.ts` returns it as `plugin.script`. This mirrors how other script-injecting plugins in the repo split build-time vs runtime code.

## Testing

Playwright suite (`test/focus.spec.ts`) covering:

1. **User-driven tab navigation** — keyboard `Tab` walks 3 inputs; trace shows 3 `focus.changed` events with `cause: 'unknown'`, correct `previous` chain, `role: 'textbox'`, accessible names matching `<label>` text.
2. **Programmatic `.focus()`** — button click handler calls `inputRef.focus()`; trace shows event with `cause: 'programmatic'` and `callSite` containing the handler's file/line.
3. **`autofocus` on load** — initial-focus event fires with `previous: null` and `cause: 'unknown'`.
4. **Focus inside shadow DOM** — focusing an input inside a shadow-root component yields `target.shadowPath: ['my-component']` and the inner element's tag/role.
5. **Focus moves into same-origin iframe** — main frame emits `focus.changed` with `target.tag: 'iframe'`; iframe's own injected instance emits its own `focus.changed` with `origin` set to the child frame's origin.
6. **Modal focus trap** — opening a modal moves focus, closing returns it; trace shows the round-trip with `cause: 'programmatic'` on both transitions.
7. **`origins` option gates injection** — when `origins: [/^http:\/\/localhost:3000/]` is set and the test page is served from a different port, no events are emitted.

All assertions go through `introspect events --type focus.changed` (dogfooding the CLI), per project conventions.

## Open questions (for plan, not blocking design)

- Selector strategy under heavy DOM (>1000 nodes) — bounded depth is fine but exact bound TBD by perf-testing in the plan phase.
- Whether to debounce rapid focus thrash (e.g. accessibility libraries that briefly steal focus). Lean: don't; every transition is information.
