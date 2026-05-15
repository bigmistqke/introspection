# Demo test hung because `useMemo` + `use()` recreated a promise every render

Date: 2026-04-13

Context: while building `plugin-react-scan`, the `demos/react-trace-list` test started failing. Symptom was a Playwright timeout waiting for body text matching `Traces|No traces`. The browser was stuck on the top-level `<Suspense>` fallback "Loading traces…". Root cause: `App.tsx` wrapped `listTraces(adapter)` in `useMemo(..., [])`, but React 19 can drop memoized values when a component suspends — so each retry created a new promise, `use()` never resolved, and Suspense never unwound. Fix: hoist the promise to module scope.

## Flow

1. Ran `pnpm -C demos/react-trace-list test` → saw the 10s Playwright timeout on `toContainText(/Traces|No traces/)`.
2. **Did not reach for introspect.** Edited `test/demo.spec.ts` to add `page.on('console', msg => ...)` and `page.on('pageerror', err => ...)`.
3. Re-ran → watched browser console spam `[APP] rendering` / `[APP] creating promise` dozens of times before the timeout.
4. Hypothesised `reactScanPlugin` was causing the loop. Wrote a second throwaway spec without the plugin → still hung. Concluded: pre-existing demo bug.
5. Hoisted `listTraces(adapter)` out of the `App` component. Test passed.
6. Later, to verify `react-scan` events were landing, ran `cat demos/react-trace-list/.introspect/*/events.ndjson | grep '"type":"react.render"'`.

## Gaps

- **Muscle-memory gap.** The `console` plugin was already capturing the `[APP] rendering` spam (App.tsx has existing `console.log` calls). `introspect events --type console` would have shown the render loop on the first attempt. `page.on('console')` + re-running the test achieved the same thing with more effort.
- **Formatter gap** (fixed this trace). At the time, `formatTimeline` in `packages/cli/src/commands/events.ts` had no branch for `console` events, so even if I had run `introspect events`, the spam would have printed as 30 bare `console` lines with no payload. Invisible. *Fix landed*: added `console` and `browser.navigate` branches in `events.ts:50-52`, with tests.
- **Skill gap** (fixed this trace). `introspect-debug/skill.md` had no "test hung / timed out" branch pointing at `introspect events --last N`. *Fix landed*: added that decision-tree entry + a "suspiciously repeated events" entry + a golden-rule callout that `page.on` / ndjson-grep are regressions.
- **Muscle-memory gap (verification phase).** Used `cat … | grep '"type":"react.render"'` to confirm events landed, instead of `introspect events --type react.render`. The CLI already supports this; I just didn't reach for it. No code fix; recurring pattern worth watching.
- **Workflow friction (open).** Between test runs I `rm -rf .introspect/` to avoid confusion about which trace was "latest." With every run appending a new trace dir, disambiguating the one I just produced from the previous four is easy to get wrong in a long debug loop. Not fixed.

## Proposed fixes

- **None outstanding in code** — the two mechanical fixes (formatter branches + skill updates) landed during the trace.
- **Consider** showing start-time or label in the `introspect summary` header so "latest trace" is visibly tied to the run just completed. Reduces the need to `rm -rf .introspect/` between runs.
- **Consider** one-liner in the test scaffold template (or `introspect-setup` skill) that reminds developers: `handle.detach({ status: 'passed' })` is required for `introspect list` to show a duration and for `introspect summary` to classify the trace as complete.

## Open questions

- Should reflections live in `.claude/reflections/` (private, agent-only) or `docs/dogfood/` (committed, team-visible)? Leaning committed — the accumulated backlog is team signal, not per-trace chat.
- Should `introspect` optionally clear prior traces on attach (opt-in flag, or a `fresh: true` option)? Would remove the `rm -rf` reflex but might hide cross-run regressions someone wanted to keep.
- Should the `console` plugin add per-event call-site info (file:line)? Would make "30x [APP] rendering from App.tsx:15" even more actionable. Not sure if CDP provides this cheaply.
