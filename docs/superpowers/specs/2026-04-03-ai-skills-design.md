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

`introspect skills install` reads skills from the CLI's own installed location (`__dirname/../skills/`) and copies them to the target directory.

## CLI Commands

```
introspect skills                           # show help
introspect skills list                      # list available skills with descriptions
introspect skills install                   # auto-detect platform, install all skills
introspect skills install --platform claude # explicit platform
introspect skills install --dir <path>      # override target install directory
```

### Platform Auto-Detection

`introspect skills install` (no flags) inspects the current working directory:

- `.claude/` directory found → Claude Code
- `GEMINI.md` found → Gemini CLI
- Both or neither → error with prompt to specify `--platform`

### Install Targets

| Platform | Default install path |
|----------|---------------------|
| Claude Code | `.claude/plugins/introspect-<name>/skill.md` |
| Gemini | reserved for future implementation |

**v1 implements Claude Code only.** The `--platform` flag is present from day one so the architecture supports expansion without a breaking change.

## Skills

Three skills are included:

### `introspect-debug`

**Trigger:** A Playwright test fails and the AI needs to understand why.

**Content:** A decision tree starting from `introspect summary <trace>`:
- JS errors found → `introspect errors <trace>` then `introspect vars <trace>`
- Network failures → `introspect network --failed <trace>` then `introspect body <id> <trace>`
- Nothing obvious → `introspect timeline <trace>` to scan chronologically
- DOM issue suspected → `introspect dom <trace>`

Includes inline reference for common event types (`network.request`, `network.response`, `js.error`, `js.console`, `playwright.action`, `mark`, `plugin.*`) and what each indicates.

### `introspect-setup`

**Trigger:** The AI is adding introspection to a project for the first time.

**Content:** Step-by-step setup:
1. Install packages (`@introspection/vite`, `@introspection/playwright`, optional plugins)
2. Add `introspection()` to `vite.config.ts`
3. Call `attach(page)` in Playwright tests
4. Optionally add `@introspection/playwright-fixture` for zero-boilerplate usage
5. Optionally register plugins (React, Redux, Zustand, WebGL) in the vite config
6. Verify: run a test, check that `.introspect/*.trace.json` files appear, run `introspect summary`

### `introspect-plugin`

**Trigger:** The AI needs to write a custom introspection plugin (e.g. for MobX, XState, or a project-specific state manager).

**Content:**
- The `IntrospectionPlugin` interface: `name`, `browserSetup()` (runs in-page), `serverSetup()` (runs in Vite plugin)
- How to emit events: `agent.emit({ type: 'plugin.<name>.<event>', data: {...} })`
- How to add data to error snapshots: `onSnapshot()` hook
- How to filter or transform events: `transformEvent()` returning null drops the event
- Minimal working example (a plugin that tracks a custom global counter)
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
  package.json           # add skills/ to "files"
```

## Skill File Format

Standard superpowers skill frontmatter:

```markdown
---
name: introspect-debug
description: Use when a Playwright test fails — guides querying the trace to identify root cause
---

# content here
```

## Error Handling

- If target directory does not exist, create it (mkdir -p)
- If a skill file already exists at target, overwrite with a warning: `Overwriting existing skill: <path>`
- If the CLI cannot locate its own `skills/` directory (e.g. bundled incorrectly), exit with a clear error message

## Out of Scope

- Dynamic/config-aware skill generation (deferred — static is sufficient for v1)
- Gemini CLI support (reserved, not implemented)
- A skill registry or remote skill distribution
- Skill uninstall command
