# @introspection/plugin-network

Captures all HTTP network activity via CDP.

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
| `network.response` | Every response (with body written to `assets/`) |
| `network.error` | Failed or aborted request |

Response bodies are written as sidecar assets. The `network.response` event includes a `bodySummary` with extracted keys, scalars, and error fields for quick inspection.

## Options

None. The plugin captures all requests unconditionally.
