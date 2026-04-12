# @introspection/plugin-network

Captures all HTTP network activity via CDP.

Records every request, response, and error that crosses the network during page navigation and user interactions. Response bodies are automatically captured as assets for later inspection. Useful for debugging network-related issues, validating API contracts, or analyzing performance bottlenecks.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [What it captures](#what-it-captures)
- [Options](#options)

## Install

```bash
pnpm add -D @introspection/plugin-network
```

## Usage

```ts
import { attach } from '@introspection/playwright'
import { network } from '@introspection/plugin-network'

const handle = await attach(page, { plugins: [network()] })
```

Or via `defaults()` which includes `network()` automatically:

```ts
import { attach } from '@introspection/playwright'
import { defaults } from '@introspection/plugin-defaults'
const handle = await attach(page, { plugins: defaults() })
```

## What it captures

| Event type | Trigger |
|---|---|
| `network.request` | Every outgoing request |
| `network.response` | Response headers/status received |
| `network.response.body` | Body buffered and captured as an asset (linked to its `network.response` via `initiator`) |
| `network.error` | Failed or aborted request |

### Two-phase response capture

`network.response` and `network.response.body` are emitted separately:

- `network.response` fires **synchronously** on CDP's `Network.responseReceived` — the headers-and-status event. It always fires for every response.
- `network.response.body` fires on CDP's `Network.loadingFinished`, once the body is buffered and retrievable via `Network.getResponseBody`. It carries the body as `assets[0]` and sets `initiator` to the matching `network.response` event's `id`.

The split exists because some responses **never finish from CDP's perspective** — Server-Sent Events, long-polling, and routed requests served via Playwright's `route.fulfill` (Fetch.fulfillRequest) don't fire `loadingFinished`. Coupling the emit to the body would hang `handle.flush()` forever in those cases. With the split, every request still emits `network.response`; `network.response.body` only appears when the body is actually available.

To correlate a response with its body, filter events on `initiator`:

```ts
const response = events.find(e => e.type === 'network.response' && e.metadata.url.endsWith('/api/data'))
const body = events.find(e => e.type === 'network.response.body' && e.initiator === response?.id)
```

### When body won't be captured

- **Streaming responses** (SSE, long-polling, chunked with no termination) — connection stays open, `loadingFinished` never fires.
- **Routed requests** (Playwright `route.fulfill`) — fulfilled at the Fetch layer, `Network.getResponseBody` returns "No data found". Use a real HTTP server in tests when body capture matters.
- **Failed/aborted requests** — `network.error` is emitted instead; there's no body to capture.
- **Unread bodies** — if the page calls `fetch(url)` without consuming the body (no `.text()`, `.json()`, reader loop, etc.), Chromium may not finish the request and `loadingFinished` won't fire.

## Options

```ts
network({ verbose: true })
```

| Option | Type | Default | Description |
|---|---|---|---|
| `verbose` | `boolean` | `false` | Log CDP events and body-capture flow to stdout via `createDebug('plugin-network')`. Useful for diagnosing missing body events. |
