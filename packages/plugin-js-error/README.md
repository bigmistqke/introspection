# @introspection/plugin-js-error

Captures JS exceptions and unhandled promise rejections via CDP. Emits a `js.error` event on the bus for plugin coordination.

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
import { attach, defaults } from '@introspection/playwright'
const handle = await attach(page, { plugins: defaults() })
```

## What it emits

| Event type | Description |
|---|---|
| `js.error` | JS exception or unhandled promise rejection |
| bus('js.error') | Signal for other plugins to react |

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
