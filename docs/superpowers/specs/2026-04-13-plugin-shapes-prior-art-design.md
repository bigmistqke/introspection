# Plugin shapes — prior art (docs-only)

Document the three different packaging shapes we've used so far for framework/library plugins, so future plugin authors can recognise the pattern that fits their target library — without presenting our current list as a closed taxonomy.

## Background

Three existing plugins hook into their target libraries in visibly different ways:

- `plugin-redux` — injects a plain script that impersonates the Redux DevTools Extension wire protocol (`window.__REDUX_DEVTOOLS_EXTENSION__`). Zero deps, zero user code.
- `plugin-react-scan` — bundles `react-scan` + a thin adapter into a self-contained IIFE and injects it before page scripts. `react-scan` communicates with React via a published global hook, so a bundled copy works fine. Zero user code.
- `plugin-solid-devtools` — bundles an IIFE, but also ships a `/setup` submodule the user imports in their app entry. Solid's reactivity is module-scoped: `useDebugger()` only observes reactive roots created with the same `solid-js` module instance. The setup module instantiates the debugger using the app's runtime and exposes it globally; the IIFE picks it up.

The discrepancy isn't arbitrary — each shape is forced by a constraint in the target library. The question this spec addresses: how should that knowledge be written down so it's useful to the next plugin author?

## Non-goals

- No code changes to existing plugins.
- Not a closed taxonomy of packaging options. We have three data points; other shapes (runtime monkey-patching, build-time instrumentation, first-class debug hooks, CDP-only capture) are plausible and haven't been explored in this repo.
- Not a refactor of the existing plugin READMEs. We're adding a trailing note, not rewriting them.
- Not fixing the stale `SolidDevtools$$` reference in `plugin-solid-devtools/README.md` — adjacent drift, out of scope.

## Changes

### 1. CONTRIBUTING.md — new subsection "Plugin shapes — prior art"

**Location:** under the existing "Plugins" section, inserted between "Plugins with browser-side code" and "Step-by-step: adding a new in-repo plugin".

**Framing:** the section title and opening sentence make clear this is a catalogue of shapes we've built, not a decision tree that covers every case. Phrasing along the lines of "These are the shapes we've used so far — not a closed taxonomy."

**Content:** three named patterns, each with (a) the constraint in the target library that forces that shape, (b) what the plugin ships, (c) the exemplar plugin in this repo.

- **Protocol shim.** Target library talks to a devtool through a global wire protocol (e.g. `window.__REDUX_DEVTOOLS_EXTENSION__`). The plugin impersonates the protocol consumer. Ships a plain script, zero deps, zero user code. *Example: `plugin-redux`.*
- **Bundled injection.** Target devtool can function standalone because it communicates with the app framework through a published global hook (e.g. `__REACT_DEVTOOLS_GLOBAL_HOOK__`), not shared module state. The plugin bundles the devtool + a thin adapter as an IIFE and injects it before page scripts run. Zero user code. *Example: `plugin-react-scan`.*
- **Bundled injection + user setup.** Target devtool needs the same *module instance* as the app — typically because the framework's reactive or instrumentation state is module-scoped. A bundled copy can't see the app's state. The plugin ships an IIFE *and* a `/setup` submodule; the user imports the submodule in their app entry, which instantiates the devtool with the app's runtime and exposes it globally for the IIFE to pick up. *Example: `plugin-solid-devtools`.*

**Closing paragraph** (replaces the earlier "decision tree"). Frames the choice as working backward from the target library's constraints — not as a flowchart that must land on A/B/C. Wording roughly:

> These are the shapes we've used so far, not a closed taxonomy. When considering a new framework/library plugin, work backward from the target library's constraints: does it publish a wire protocol on globals? Can its devtool run with its own module instance, or does it need module-identity with the app? Does it have a first-class debug hook, or need build-time transformation? The answers may land you in one of the three shapes above — or in a fourth. If you find yourself inventing a new shape, document it here so the next author sees it.

### 2. Per-plugin README — trailing "Architecture" note

For each of the three plugins, add a short section titled `## Architecture` at the end of the README (after existing content, explicitly secondary — not primary information). 2–3 sentences each. Names the shape, states the constraint that forced it, links to the CONTRIBUTING.md section for the full catalogue.

- `plugins/plugin-redux/README.md` — names "Protocol shim." Constraint: the Redux DevTools Extension defines a wire protocol on globals, so we intercept at that layer and any compatible store connects automatically.
- `plugins/plugin-react-scan/README.md` — names "Bundled injection." Constraint: `react-scan` hooks `__REACT_DEVTOOLS_GLOBAL_HOOK__` rather than sharing React's module state, so a self-contained copy observes the app's React correctly.
- `plugins/plugin-solid-devtools/README.md` — names "Bundled injection + user setup." Constraint: `solid-js` reactivity is module-scoped, so the debugger must be instantiated with the app's `solid-js` runtime (via the `/setup` import), not a bundled copy.

Each note ends with a link to the "Plugin shapes — prior art" section in `CONTRIBUTING.md`. The anchor slug depends on how GitHub converts the em-dash in the heading; the implementation should verify the generated anchor (or pick a heading without an em-dash if that simplifies things).

## Out of scope (flagged for later)

- `plugin-solid-devtools/README.md`'s "Requirements" section still references a global `SolidDevtools$$` that doesn't match the current `/setup` import mechanism. Adjacent drift; fix separately.
