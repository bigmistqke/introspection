# Introspection: Future Possibilities

## Context

During plugin-redux testing, a pattern emerged: when debugging fixture pages, we reached for custom Playwright scripts instead of using introspection itself. This revealed gaps in introspection as a **development workflow tool**. Currently optimized for test post-mortems, it should also be the go-to for **live browser debugging**.

---

## 1. Dev Mode (No Test Required)

**Current:** Introspection only works inside `attach(page, ...)` in Playwright tests. To debug a page, you must write test code.

**Desired:** Trace a live dev server without a test harness.

```bash
introspect debug http://localhost:8765/valtio-react/index.html
# Waits, captures all events for 5s, outputs session
# No test code, no harness needed
```

**Implementation notes:**
- Launch headless browser, navigate to URL, attach plugin-defaults, wait/capture
- Optional `--duration 10s` to customize capture window
- Optional `--output path/` to specify session directory
- Expose as `introspect debug <url> [options]`

**Benefits:**
- Fixture/component debugging without test setup
- Works during dev server operation (Vite, Next, etc.)
- Instant trace of "why is this page broken?"

---

## 2. Error-Centric Querying

**Current:** `introspect events --type js.error` works but requires knowing to look for errors.

**Desired:** Error-first commands that surface failures immediately.

```bash
introspect errors                    # All JS errors in session
introspect last-error                # Most recent error + context
introspect errors --with-console     # Errors + console output before/after
introspect errors --with-stack       # Include full call stack
```

**Implementation notes:**
- `introspect errors` = sugar for `introspect events --type js.error`
- `last-error` queries for the most recent error, shows 3-event window (before + error + after)
- `--with-console` adds console events from ±5 seconds around each error
- `--with-stack` includes the debuggerPlugin call stack if available

**Benefits:**
- Focus on signal (what failed) not noise
- Faster problem identification
- Works with plugin-js-error, plugin-debugger

---

## 3. Browser Console as Built-in Plugin

**Current:** Console output is optional (needs consolePlugin). During dev debugging, we want it always-on.

**Desired:** Console plugin enabled by default in dev mode; visible, severity-aware output.

```bash
introspect debug <url> --console     # Enables console plugin
# Output shows:
# [ERROR] proxyState is not iterable
# [WARN]  Please use proxy object
# [LOG]   %cDownload React DevTools...
```

**Implementation notes:**
- Add `--console` flag to `introspect debug`
- Auto-add consolePlugin if flag is present
- Severity levels (error=red, warn=yellow, log=default) in CLI output
- Include timestamp and source (if available from CDP)

**Benefits:**
- Instant visibility to what the browser was saying
- No custom script needed to capture console
- Replay browser experience without browser open

---

## 4. DOM Snapshots Tied to Errors

**Current:** DOM snapshots are captured by plugin-debugger on pauses, not automatically on errors.

**Desired:** Automatic snapshot when JS error occurs; query DOM state at moment of failure.

```bash
introspect debug <url>
# Error occurs, dom snapshot auto-captured

introspect snapshots --at-error           # DOM when error happened
introspect snapshots --before-error       # DOM right before error
introspect snapshots --after-error --all  # All snapshots after first error
```

**Implementation notes:**
- Extend plugin-js-error to also capture DOM snapshot via `DOM.getDocument` + `DOM.getOuterHTML`
- Store snapshot as asset alongside error event
- Query: filter snapshots by temporal relationship to errors
- Output: render HTML, show structure, highlight elements mentioned in error

**Benefits:**
- See page state when it broke (was component rendered? partially? not at all?)
- Faster diagnosis than "error happened here, now what?"
- Works without debugger pauses (js.error alone triggers it)

---

## 5. Live Tail Mode

**Current:** Must run query after session completes.

**Desired:** Stream events in real-time as they happen (like `tail -f` for traces).

```bash
introspect debug <url> &
sleep 1

introspect tail --session latest            # Stream all events as they arrive
introspect tail --type js.error,console     # Filter to specific types
introspect tail --live --watch              # Re-attach on file changes
```

**Implementation notes:**
- Tail mode reads the session's events.ndjson file and streams lines as they're appended
- Requires session to be open (tracking in-progress)
- Can watch for new sessions: `tail --session latest --follow`
- With `--watch`, re-attach if source file changes (useful with --live)
- Output: stream format (one event per line, JSON or pretty-printed)

**Benefits:**
- Watch page behavior live without browser open
- Spot errors as they happen
- Useful for flaky/intermittent issues

---

## 6. Session Comparison

**Current:** Each session is independent; no built-in before/after comparison.

**Desired:** Compare two sessions to see what changed (errors, timings, behavior).

```bash
introspect compare session-before session-after
# Shows:
# - Errors that disappeared
# - New errors introduced
# - Events with different counts
# - Performance differences
```

**Implementation notes:**
- Read both sessions' meta.json and events.ndjson
- Diff event types/counts
- Highlight errors that appear/disappear
- Show timing deltas if available
- Report: "X errors removed, Y errors added, Z events changed count"

**Benefits:**
- Validate fixes (confirm error is gone)
- Regression detection (new errors after change)
- Performance comparison (did this change slow things down?)

---

## 7. Fixture-Aware Dev Server Integration

**Current:** Must manually attach to pages; dev servers are unaware of introspection.

**Desired:** Dev server middleware auto-injects introspection, zero-config tracing.

```bash
# vite.config.ts
export default defineConfig({
  plugins: [introspectionPlugin()],  // or auto-imported from @introspection/vite
  // Automatically serves all pages with introspection script
})

# Then just:
introspect debug http://localhost:5173/some-page
# Page is already instrumented, session ready
```

**Implementation notes:**
- Create @introspection/vite plugin (Vite middleware)
- Injects addInitScript equivalent for all served pages
- Registers __introspect_push__ binding
- Optional: configurable allowlist (trace only certain routes)
- Fallback: works for non-Vite servers too (HTTP middleware)

**Benefits:**
- Zero code changes to fixtures
- Automatic tracing during normal dev
- Works with any dev server (Vite, Next, webpack-dev-server, etc.)

---

## 8. Interactive Query REPL

**Current:** Each `introspect` command is separate; must re-run to try different queries.

**Desired:** Interactive shell for exploring session without re-running.

```bash
introspect repl session-id

# Now inside repl:
> errors
# [error] proxyState is not iterable
# [error] Cannot read property 'count' of undefined

> snapshots --at-error 0
# [HTML render of DOM at first error]

> console --level warn
# [all warnings in order]

> events --type network.response --filter 'status >= 400'
# [matching network events]

> compare other-session
# [diff view]

> help
# [command reference]
```

**Implementation notes:**
- Use readline or similar for interactive shell
- Commands are existing `introspect` queries without the `introspect` prefix
- State: current session loaded in memory
- Commands: events, errors, snapshots, network, console, compare, summary, export
- Exit: `quit` or Ctrl+D

**Benefits:**
- Faster exploration (no CLI overhead per command)
- Reduces mental friction ("what should I query next?")
- Better for iterative debugging

---

## 9. Watch Mode with Auto-Reattach

**Current:** `introspect debug` captures once; to re-capture, must re-run manually.

**Desired:** Watch source files, re-trace automatically on change.

```bash
introspect debug http://localhost:8765/page --watch --watch-files 'src/**/*.ts'
# On file change, re-attaches and captures a new session
# Useful for: fixture development, debugging intermittent issues
```

**Implementation notes:**
- Use chokidar or similar to watch files
- On change, wait for dev server to hot-reload (configurable delay)
- Re-run `introspect debug`, save to time-stamped session dir
- Optional: `--keep-previous` to retain old sessions for comparison

**Benefits:**
- Automate fixture debugging loop
- Capture behavior changes as you edit
- No manual re-run needed

---

## 10. Session Metadata & Search

**Current:** Sessions are isolated; no cross-session search.

**Desired:** Search and index sessions by metadata (errors, routes, duration).

```bash
introspect search --error 'proxyState'  # Find all sessions with this error
introspect search --route '/valtio*'    # All sessions that hit routes matching pattern
introspect search --duration-gt 5s      # Sessions slower than 5 seconds
introspect search --tags fixture        # Custom tags added at trace time
```

**Implementation notes:**
- Index meta.json of all sessions (or just a configurable directory)
- Build simple in-memory index on each search (or cache)
- Filter by: error message, route, duration, tags, testTitle, date range
- Output: list of matching sessions with quick summary

**Benefits:**
- Find relevant sessions across many runs
- Spot patterns (all errors on specific route?)
- Useful for regression testing (find "before" session)

---

## 11. Export & Integration

**Current:** Sessions are NDJSON + assets; limited export options.

**Desired:** Export to standard formats for external tools.

```bash
introspect export session-id --format junit     # JUnit XML for CI
introspect export session-id --format html      # Interactive HTML report
introspect export session-id --format console   # Plain text summary
introspect export session-id --format json      # Structured JSON
```

**Implementation notes:**
- JUnit: convert errors/events to test cases
- HTML: interactive timeline, errors highlighted, snapshots embedded
- Console: markdown-friendly summary (good for commit messages)
- JSON: full fidelity export for programmatic use

**Benefits:**
- Integrate with CI/CD (fail on errors found in trace)
- Share reports (HTML snapshots with team)
- Programmatic access to trace data

---

## 12. Performance Profiling Mode

**Current:** Can measure event timings, but no performance-specific query.

**Desired:** Performance-focused queries and output.

```bash
introspect perf session-id
# Shows:
# - Slowest network requests
# - Longest-running JS execution
# - Largest DOM snapshots
# - Layout shifts (if performance plugin active)

introspect perf --type network --top 5
introspect perf --flame-graph         # Generate flame graph (with performance plugin)
```

**Implementation notes:**
- Aggregate timings from all events
- Sort by duration, size, frequency
- Optional: flamegraph generation (if performance data available)
- Works with plugin-performance for deep metrics

**Benefits:**
- Quick performance diagnosis
- Identify bottlenecks without external tools
- Useful for fixture optimization

---

## Summary: The Vision

**Introspection should be the browser equivalent of system debugging tools:**
- `strace` for seeing what the page is doing (tail, events)
- `gdb` for inspecting state at failure (snapshots, console, stack)
- `perf` for performance analysis (perf command)
- `git` for comparison and history (compare, search)

**Key theme:** Move from "post-mortem test debugging" to **"live development companion."**

When you run a dev server and something breaks, reaching for `introspect debug <url>` should be as natural as opening DevTools in a browser — and provide more structure and queryability than DevTools can.

