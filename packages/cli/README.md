# introspect

CLI for querying introspection traces recorded by `@introspection/playwright`.

## Table of contents

- [Install](#install)
- [Global options](#global-options)
- [Commands](#commands)
  - [debug](#debug)
  - [list](#list)
  - [summary](#summary)
  - [events](#events)
  - [network](#network)
  - [assets](#assets)
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

### `debug`

Launch a browser and record a live debugging session with introspection. Useful for capturing ad-hoc behavior without writing a test.

```
introspect debug [<url> | --serve <path>] [--config <path>] [--playwright <script>]
```

| Flag | Description |
|---|---|
| `<url>` | Navigate to a remote URL (e.g. `https://example.com`) |
| `--serve <path>` | Serve a local file or directory and navigate to it (auto-picks free port) |
| `--config <path>` | Path to `introspect.config.ts` (default: `./introspect.config.ts`) |
| `--playwright <script>` | Playwright script to run: file path or inline code. Has `page` in scope. |

The command loads plugins from `introspect.config.ts`, records the session to `.introspect/`, and prints the session ID.

**Examples:**

```bash
# Debug a remote site
introspect debug https://example.com

# Serve a local HTML file and debug it
introspect debug --serve ./index.html

# Serve a directory (navigates to index.html)
introspect debug --serve ./dist

# Run interactions with a Playwright script
introspect debug --serve ./app.html --playwright ./interactions.ts

# Inline Playwright script
introspect debug https://example.com --playwright 'await page.click("button")'
```

---

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
  [--after <ms>] [--before <ms>] [--since <label>] [--last <n>]
```

| Flag | Description |
|---|---|
| `--filter <expr>` | Boolean predicate per event (`event`), e.g. `'event.metadata.status >= 400'` |
| `--format <fmt>` | Output format: `text` (default) or `json` |
| `--type <types>` | Comma-separated event types to include. Supports prefix matching with `.*` suffix (e.g. `network.*` matches all network events) |
| `--after <ms>` | Keep events after this timestamp (ms since session start) |
| `--before <ms>` | Keep events before this timestamp (ms since session start) |
| `--since <label>` | Keep events after the named `mark` event |
| `--last <n>` | Keep only the last N events |

Examples:

```bash
introspect events --type js.error
introspect events --type network.*              # Prefix matching: all network events
introspect events --type network.response --filter 'event.metadata.status >= 400'
introspect events --type webgl.uniform --last 20
introspect events --since before-submit
introspect events --format json | jq '.[].metadata.url'
```

---

### `network`

Display network requests and responses as a table.

```
introspect network [--session <id>] [--failed] [--url <pattern>]
```

| Flag | Description |
|---|---|
| `--failed` | Show only responses with status >= 400 and network errors |
| `--url <pattern>` | Filter by URL substring |

Output columns: `STATUS`, `METHOD`, `URL`, `EVENT_ID`. Network errors appear with status `ERR`.

---

### `assets`

List and display assets written during the session.

```
introspect assets [--session <id>] [path]
```

Without a path argument, lists all asset paths. With a path, displays the asset content.

```bash
introspect assets                    # list all assets
introspect assets abc123.json        # display asset content
```

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
