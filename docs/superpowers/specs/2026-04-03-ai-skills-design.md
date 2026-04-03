# AI Skills Design

**Date:** 2026-04-03
**Status:** Approved

## Overview

Ship Claude Code skills alongside the `introspect` CLI so AI agents automatically know how to use the library. Skills are static markdown files distributed in the npm package and installed into a project's `.claude/plugins/` directory via `introspect skills install`.

## Goals

- AI agents in any project using introspection can query traces effectively without needing to figure out the CLI on their own
- Skills are versioned with the CLI — no separate package or sync overhead
- Simple: no config parsing, no template rendering, just file copying

## Distribution Model

Skills live in `packages/cli/skills/<skill-name>/skill.md`. They are included in the npm publish via the `files` field in `packages/cli/package.json`. When a user installs the `introspect` package, the skills come with it inside `node_modules`.

`introspect skills install` reads skills from the CLI's own installed location. The tsup entry point produces `dist/index.js`; the skills directory is a sibling of `dist/`, so the correct ESM-compatible resolution is:

```ts
fileURLToPath(new URL('../skills/', import.meta.url))
```

This resolves to `packages/cli/skills/` when running from `dist/index.js`. Note: `__dirname` is not available in ESM — `import.meta.url` must be used.

## CLI Commands

```
introspect skills                           # show help
introspect skills list                      # list available skills with descriptions
introspect skills install                   # auto-detect platform, install all skills
introspect skills install --platform claude # explicit platform
introspect skills install --dir <path>      # override target install directory
```

`--platform` accepts `claude` only in v1. Any unrecognised value exits with a non-zero error: `Unknown platform: <value>. Supported platforms: claude`. Update this list as platforms are added.

`--dir <path>` replaces the platform root entirely. Skills are installed at `<path>/introspect-<name>/skill.md`, resolved relative to cwd. When `--dir` is specified, `--platform` has no effect on path resolution and is ignored with a warning: `--platform is ignored when --dir is specified.`

### `skills list` Output Format

Tab-aligned two-column table, one skill per line:

```
introspect-debug    Use when a Playwright test fails — guides querying the trace to identify root cause
introspect-setup    Use when adding introspection to a project for the first time
introspect-plugin   Use when writing a custom introspection plugin
```

Output is always read from the CLI's bundled skills directory (not from the install target). If the skills directory is missing, exit with a non-zero error. If a skill file is present but has missing or malformed YAML frontmatter, skip it and print a warning to stderr: `Warning: could not parse skill at <path>, skipping.`

### Platform Auto-Detection

`introspect skills install` (no `--platform` flag) inspects the current working directory:

- `.claude/` directory found (no `GEMINI.md`) → Claude Code
- `GEMINI.md` found (no `.claude/`) → exit non-zero: `Gemini platform detected but not yet implemented. Use --platform claude.` (Note: heuristic only; `GEMINI.md` could exist for unrelated reasons; false positives hit this error, which is recoverable via `--platform claude`.)
- Both found → exit non-zero: `Multiple platforms detected. Use --platform claude to specify one. (Gemini support is not yet implemented.)`
- Neither found → default to Claude Code with a warning: `No platform detected; defaulting to claude. Use --platform to be explicit.`

### Install Targets

| Platform | Default install path |
|----------|---------------------|
| Claude Code | `.claude/plugins/introspect-<name>/skill.md` |
| Gemini | reserved for future implementation |

**v1 implements Claude Code only.** The `--platform` flag is present from day one so the architecture supports expansion without a breaking change.

## Skills

Three skills are included. All skill content must use the actual CLI flag forms (no positional `<trace>` argument — all commands take `--trace <name>` except `body` and `eval`).

### `introspect-debug`

**Trigger:** A Playwright test fails and the AI needs to understand why.

**Content:** A decision tree. All commands default to the latest trace; add `--trace <name>` to target a specific one. The `eval` command connects to a live socket and never takes `--trace`.

```
introspect summary
  → JS errors found:
      introspect errors
      introspect vars                    # add --at <point> to narrow to a specific moment
  → Network failures:
      introspect network --failed
      introspect body <eventId>          # reads body from .introspect/bodies/
  → Nothing obvious:
      introspect timeline
  → DOM issue suspected:
      introspect dom
```

Includes inline reference for common event types and what they indicate:

| Type | Source | Meaning |
|------|--------|---------|
| `network.request` / `network.response` | CDP | HTTP traffic with full bodies |
| `js.error` | CDP | Uncaught exception with source-mapped stack |
| `js.console` | CDP | Console output |
| `playwright.action` | Playwright | click, fill, navigate, etc. |
| `mark` | browser agent | Semantic marker placed by test code |
| `plugin.*` | plugin | Framework-specific data (Redux action, React commit, etc.) |

### `introspect-setup`

**Trigger:** The AI is adding introspection to a project for the first time.

**Content:** Step-by-step setup:
1. Install packages (`@introspection/vite`, `@introspection/playwright`, optional plugins)
2. Add `introspection()` to `vite.config.ts`
3. Call `attach(page)` in Playwright tests (or use `@introspection/playwright-fixture` for zero-boilerplate)
4. Optionally register plugins (React, Redux, Zustand, WebGL) in the vite config
5. Verify: run a test, confirm `.introspect/*.trace.json` files appear, run `introspect summary`

### `introspect-plugin`

**Trigger:** The AI needs to write a custom introspection plugin (e.g. for MobX, XState, or a project-specific state manager).

**Content:**
- The `IntrospectionPlugin` interface: `name`, `browserSetup()` (runs in-page), `serverSetup()` (runs in Vite plugin)
- How to emit events: `agent.emit({ type: 'plugin.<name>.<event>', data: {...} })`
- How to add data to error snapshots: `onSnapshot()` hook
- How to filter or transform events: `transformEvent()` returning null drops the event
- Minimal working example (a plugin that captures a custom global counter)
- Pointer to existing plugins as reference: `packages/plugin-react`, `packages/plugin-redux`

## File Layout

```
packages/cli/
  skills/
    introspect-debug/
      skill.md
    introspect-setup/
      skill.md
    introspect-plugin/
      skill.md
  src/
    commands/
      skills.ts          # skills list + skills install commands
  package.json           # "files": ["dist", "skills"]
```

## package.json `files` Field

Ensure the `files` field includes both `"dist"` and `"skills"`:

```json
"files": ["dist", "skills"]
```

## Skill File Format

Each skill file uses YAML frontmatter with `name` and `description` fields:

```markdown
---
name: introspect-debug
description: Use when a Playwright test fails — guides querying the trace to identify root cause
---

# content here
```

## Error Handling

- If target directory does not exist, create it (mkdir -p equivalent via `fs.mkdir` with `recursive: true`)
- If a skill file already exists at target, overwrite with a warning: `Overwriting existing skill: <path>`
- If the CLI cannot locate its own `skills/` directory, exit with a clear error: `Could not find bundled skills directory. Try reinstalling the introspect package.`

## Out of Scope

- Dynamic/config-aware skill generation (deferred — static is sufficient for v1)
- Gemini CLI support (reserved, not implemented)
- A skill registry or remote skill distribution
- Skill uninstall command
