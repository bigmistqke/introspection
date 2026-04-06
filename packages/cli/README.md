# introspect

CLI for querying introspection traces recorded by `@introspection/playwright`.

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

### `timeline`

Chronological event log with optional filtering.

```
introspect timeline [--session <id>] [--type <eventType>] [--source <source>]
```

| Flag | Description |
|---|---|
| `--type <eventType>` | Show only events of this type (e.g. `network.request`) |
| `--source <source>` | Show only events from this source (`cdp`, `agent`, `playwright`, `plugin`) |

---

### `errors`

All JS errors with full stack traces.

```
introspect errors [--session <id>]
```

---

### `snapshot`

Scope chain and globals captured at the point of a JS error or manual snapshot.

```
introspect snapshot [--session <id>]
```

---

### `network`

Network requests and responses in table form.

```
introspect network [--session <id>] [--failed] [--url <pattern>]
```

| Flag | Description |
|---|---|
| `--failed` | Show only failed/errored requests |
| `--url <pattern>` | Filter by URL substring |

---

### `body <eventId>`

Full response body for a network response event. Supports JSONPath and jq queries.

```
introspect body <eventId> [--path <jsonpath>] [--jq <expr>]
```

| Flag | Description |
|---|---|
| `--path <jsonpath>` | JSONPath expression (e.g. `$.users[0].name`) |
| `--jq <expr>` | jq expression |

`eventId` is the `id` field from a `network.response` event in `events.ndjson`.

---

### `dom`

Formatted DOM tree from the most recent snapshot.

```
introspect dom [--session <id>]
```

---

### `events [expression]`

Filter and transform raw events. An optional JS expression is evaluated against each event.

```
introspect events [expression] [--session <id>] [--type <types>] [--source <source>]
  [--after <ms>] [--before <ms>] [--since <label>] [--last <n>]
```

| Flag | Description |
|---|---|
| `--type <types>` | Comma-separated event types to include (e.g. `webgl.uniform,js.error`) |
| `--source <source>` | Filter by event source |
| `--after <ms>` | Keep events after this timestamp (ms since session start) |
| `--before <ms>` | Keep events before this timestamp (ms since session start) |
| `--since <label>` | Keep events after the named `mark` event |
| `--last <n>` | Keep only the last N events |

Examples:

```bash
introspect events --type webgl.uniform --last 20
introspect events --since before-submit
introspect events 'e.data.status >= 400' --type network.response
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
