# Origins option for script injection (parked)

**Status:** parked — capture the idea, design later.

**Date:** 2026-05-08

## Problem

Every plugin that injects a browser-side `script` (console, js-error, redux, focus-element, …) currently runs in **every frame** the page owns, because Playwright's `addInitScript` does so unconditionally. There is no way to scope instrumentation to specific origins.

Use cases:

- Test against an app embedded alongside third-party iframes (ads, analytics, OAuth widgets) — don't want their console/errors/focus events polluting the trace.
- Multi-app setups where only the app under test should be instrumented.
- Performance: skip injection in frames you don't care about.

## Proposed shape

Two layers, plugin-level overrides framework-level:

1. **Framework-level default** in `IntrospectConfig` (via `@introspection/config`):
   ```ts
   {
     origins: ['http://localhost:3000', /\.myapp\.com$/],
     plugins: [...]
   }
   ```
   Applied in `attach()` when calling `page.addInitScript` and when attaching CDP sessions to frame targets. Default: all origins (current behaviour).

2. **Per-plugin override** on the plugin options:
   ```ts
   focusElement({ origins: ['http://localhost:3000'] })
   consolePlugin({ origins: [/^https:\/\/(www\.)?myapp\.com/] })
   ```
   When set, overrides the framework default for that plugin only.

Match semantics: string = exact origin match; RegExp = test against `frame.url()`'s origin. Empty array = no frames.

## Implementation sketch

- `attach()` reads `config.origins` and each plugin's `options.origins`.
- Before injecting `plugin.script` via `addInitScript`, register a wrapper that no-ops in frames whose origin doesn't match. Simplest path: wrap the script in `if (allowedOrigins.includes(location.origin)) { ... }` at install time.
- For CDP-domain plugins (network, performance), gate `cdpSession.on(...)` handlers on `frameId → origin` lookup.

## Open questions

- Should `origins` accept frame URL patterns instead of just origins (e.g. allow scoping to a specific path)?
- How does this interact with cross-origin OOPIF targets (when we later add `Target.setAutoAttach`)?
- Does the main frame always get instrumented regardless, or is it filtered too?

## Next step

Pick this up after the focus-element plugin lands. The focus-element plugin will ship with its own `origins` option (per the per-plugin layer above), so the framework option can be added incrementally without breaking it.
