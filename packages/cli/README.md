# introspect

CLI for querying introspection traces recorded by `@introspection/playwright`.

## Table of contents

- [Install](#install)
- [Global options](#global-options)
- [Commands](#commands)
  - [list](#list)
  - [summary](#summary)
  - [events](#events)
  - [assets](#assets)
  - [eval](#eval-expression)
  - [plugins](#plugins)
  - [skills list](#skills-list)
  - [skills install](#skills-install)

## Install

```bash
pnpm add -D introspect
```

## Global options

```
introspect --dir <path>   # trace directory (default: .introspect in cwd)
```

All commands accept `--dir` to point at a non-default trace directory.

---

## Commands

### `list`

List all recorded sessions sorted by recency.

```
introspect list
```

Output: session ID, duration, label.

---

### `summary`

Overview of a session: test result, Playwright actions, network failures, JS errors.

```
introspect summary [--session <id>]
```

Defaults to the most recent session when `--session` is omitted.

---

### `events`

Chronological event log with filtering. Outputs human-readable text by default; use `--format json` to get raw event objects (pipe to `jq` for field extraction).

```
introspect events [--session <id>] [--filter <expr>] [--format <fmt>] [--type <types>]
  [--source <source>] [--after <ms>] [--before <ms>] [--since <label>] [--last <n>]
```

| Flag | Description |
|---|---|
| `--filter <expr>` | Boolean predicate per event (`event`), e.g. `'event.data.status >= 400'` |
| `--format <fmt>` | Output format: `text` (default) or `json` |
| `--type <types>` | Comma-separated event types to include (e.g. `webgl.uniform,js.error`) |
| `--source <source>` | Filter by event source |
| `--after <ms>` | Keep events after this timestamp (ms since session start) |
| `--before <ms>` | Keep events before this timestamp (ms since session start) |
| `--since <label>` | Keep events after the named `mark` event |
| `--last <n>` | Keep only the last N events |

Examples:

```bash
introspect events --type js.error
introspect events --type network.response --filter 'event.data.status >= 400'
introspect events --type webgl.uniform --last 20
introspect events --since before-submit
introspect events --format json | jq '.[].data.url'
```

---

### `assets`

List and display assets written during the session.

```
introspect assets [--session <id>] [--kind <name>] [--content-type <type>] [path]
```

| Flag | Description |
|---|---|
| `--kind <name>` | Filter by asset kind (e.g. `scopes`, `body`, `webgl-canvas`) |
| `--content-type <type>` | Filter by content type (`json`, `html`, `text`, `image`) |

Without a path argument, lists all assets (or filtered subset). With a path, displays the asset content.

```bash
introspect assets                    # list all assets
introspect assets --kind scopes      # list scope assets
introspect assets abc123.json        # display asset content
```

---

### `eval <expression>`

Evaluate a JS expression against the full session trace object. The expression receives `{ session, events, snapshots }`.

```
introspect eval <expression> [--session <id>]
```

Examples:

```bash
introspect eval "events.filter(e => e.type === 'js.error').length"
introspect eval "events.find(e => e.data?.url?.includes('/api/auth'))"
```

Exits with code 1 if the expression throws.

---

### `plugins`

Show plugin metadata for a session.

```
introspect plugins [--session <id>]
```

---

### `skills list`

List available AI skills bundled with the CLI.

```
introspect skills list
```

---

### `skills install`

Install AI skills into the current project for use with Claude or other assistants.

```
introspect skills install [--platform <name>] [--dir <path>]
```

| Flag | Description |
|---|---|
| `--platform <name>` | Target platform. Currently supported: `claude`. Defaults to auto-detection. |
| `--dir <path>` | Override the install directory. When set, `--platform` is ignored. |

Without flags, the platform is auto-detected from the project. If detection fails it defaults to `claude`.
