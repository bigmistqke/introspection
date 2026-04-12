# @introspection/plugin-js-error

Captures JS exceptions and unhandled promise rejections via CDP. Emits a `js.error` event on the bus for plugin coordination.

Automatically records all runtime errors and unhandled promise rejections as they occur. Other plugins can subscribe to the `js.error` bus trigger to react immediately (e.g., capture additional state via a debugger pause). Use alongside [`@introspection/plugin-debugger`](../plugin-debugger) to capture full scope locals at the time of error.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [What it emits](#what-it-emits)
- [Bus augmentation](#bus-augmentation)
- [Scopes](#scopes)

## Install

```bash
pnpm add -D @introspection/plugin-js-error
```

## Usage

```ts
import { attach } from '@introspection/playwright'
import { jsError } from '@introspection/plugin-js-error'

const handle = await attach(page, { plugins: [jsError()] })
```

Or via `defaults()` which includes `jsError()` automatically:

```ts
import { attach } from '@introspection/playwright'
import { defaults } from '@introspection/plugin-defaults'
const handle = await attach(page, { plugins: defaults() })
```

## What it emits

| Event type | Description |
|---|---|
| `js.error` | JS exception or unhandled promise rejection |

```ts
{
  id: string
  timestamp: number
  type: 'js.error'
  metadata: {
    cdpTimestamp: number
    message: string
    stack: Array<{
      functionName: string
      file: string
      line: number
      column: number
    }>
  }
}
```

Also emits on the bus (`'js.error'` trigger) for plugin coordination.

## Bus augmentation

This plugin augments `BusPayloadMap` with a `'js.error'` trigger:

```ts
interface BusPayloadMap {
  'js.error': { trigger: 'js.error'; timestamp: number; message: string }
}
```

Other plugins can react to JS errors by subscribing to this trigger:

```ts
ctx.bus.on('js.error', async (payload) => {
  // capture additional state when a JS error occurs
})
```

To get the type augmentation, import the package (even as a side-effect):

```ts
import '@introspection/plugin-js-error'
```

## Scopes

Scope locals are captured by the separate [`@introspection/plugin-debugger`](https://github.com/introspection/plugin-debugger) plugin, which listens to `Debugger.paused` and writes a `scopes` asset with the full call stack.
