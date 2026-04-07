# @introspection/plugin-js-errors

Captures uncaught JS exceptions and unhandled promise rejections via CDP. On each error, pauses the debugger to collect scope locals from the call stack, writes a DOM snapshot, and emits a `js.error` event on the bus.

Host-agnostic — works with any CDP provider.

## Install

```bash
pnpm add -D @introspection/plugin-js-errors
```

## Usage

```ts
import { attach } from '@introspection/playwright'
import { jsErrors } from '@introspection/plugin-js-errors'

const handle = await attach(page, { plugins: [jsErrors()] })
```

Or via `defaults()` which includes `jsErrors()` automatically:

```ts
import { attach, defaults } from '@introspection/playwright'
const handle = await attach(page, { plugins: defaults() })
```

## Options

```ts
jsErrors({ pauseOnExceptions: 'all' })     // pause on caught exceptions too
jsErrors({ pauseOnExceptions: 'uncaught' }) // default — only uncaught
```

| Option | Type | Default | Description |
|---|---|---|---|
| `pauseOnExceptions` | `'all' \| 'uncaught'` | `'uncaught'` | Whether to pause on all exceptions or only uncaught ones |

## What it captures

| Event type | Trigger |
|---|---|
| `js.error` | Uncaught exception or unhandled promise rejection |
| `asset` (snapshot) | DOM + scope locals snapshot at the point of the error |

Scope collection captures up to 5 call frames, 3 scope levels per frame, and 20 properties per scope. The debugger resumes before any evaluate calls to avoid deadlocks.

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
import '@introspection/plugin-js-errors'
```
