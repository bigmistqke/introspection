# introspect

CLI for querying introspection traces recorded by `@introspection/playwright`.

## Install

```bash
pnpm add -D introspect
```

## Commands

Run `introspect <command>` from the directory containing `.introspect/` (or pass `--dir`).

### `list`

List all recorded sessions with status, duration, and label.

```
introspect list
```

### `summary`

Overview of a session: test result, actions taken, network failures, JS errors.

```
introspect summary [--session <id>]
```

### `timeline`

Chronological event log, optionally filtered.

```
introspect timeline [--session <id>] [--type network.request] [--source cdp]
```

### `errors`

All JS errors with stack traces.

```
introspect errors [--session <id>]
```

### `snapshot`

Scope chain and globals captured at the point of a JS error or manual snapshot.

```
introspect snapshot [--session <id>]
```

### `network`

Network requests/responses in table form.

```
introspect network [--session <id>] [--failed] [--url <pattern>]
```

### `body <eventId>`

Full response body for a network response event. Supports JSONPath and jq expressions.

```
introspect body <eventId> [--path $.users[0].name]
```

### `dom`

Formatted DOM tree from the most recent snapshot.

```
introspect dom [--session <id>]
```

### `events [expr]`

Filter and transform raw events. Supports `--type`, `--source`, `--since <ms>`, `--last <n>`.

```
introspect events --type webgl.uniform --last 20
```

### `eval <expr>`

Evaluate a JS expression against the session data.

```
introspect eval "events.filter(e => e.type === 'js.error').length"
```

### `skills`

Manage AI skills for use with Claude and other assistants.

```
introspect skills list
introspect skills install
```
