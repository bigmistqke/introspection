# @introspection/plugin-debugger

Introspection plugin that captures debugger pauses with scope locals and call stack information.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [Options](#options)
- [Programmatic capture](#programmatic-capture)
- [What it captures](#what-it-captures)
- [Assets written](#assets-written)

## Install

```bash
pnpm add -D @introspection/plugin-debugger
```

## Usage

```ts
import { attach } from '@introspection/playwright'
import { debuggerPlugin } from '@introspection/plugin-debugger'

const handle = await attach(page, { plugins: [debuggerPlugin()] })
```

Or via `defaults()` which includes `debuggerPlugin()` automatically:

```ts
import { attach } from '@introspection/playwright'
import { defaults } from '@introspection/plugin-defaults'
const handle = await attach(page, { plugins: defaults() })
```

## Options

```ts
debuggerPlugin({
  pauseOnExceptions: 'uncaught' | 'all'  // default: 'uncaught'
  breakpoints: [
    { url: 'app.js', line: 42 }
    { url: 'utils.js', line: 10, condition: 'user == null' }
  ]
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `pauseOnExceptions` | `'all' \| 'uncaught'` | `'uncaught'` | Whether to pause on all exceptions or only uncaught ones |
| `breakpoints` | `Array` | `[]` | Programmatic breakpoints to set |

## Programmatic capture

Import `capture` from the client module and call it in your app code:

```ts
import { capture } from '@introspection/plugin-debugger/client'

function calculate() {
  const result = heavyComputation()
  capture('after calculation')  // pauses, captures locals, resumes
  return result
}
```

`capture()` pauses the debugger, collects local variables from the call stack, and resumes — all without throwing an error. The captured scopes are written to a `scopes` asset with the label as the `message` field.

## What it captures

When the debugger pauses (due to exception, breakpoint, step, or `capture()`), it collects:

- **Scopes** — local variables from up to 5 call frames, up to 3 scopes each, 20 properties per scope
- **Stack** — full call stack with source-mapped URLs and line numbers
- **Reason** — why the debugger paused (`exception`, `promiseRejection`, `breakpoint`, `debuggerStatement`, `step`, `capture`)

## Assets written

```ts
{
  kind: 'scopes',
  trigger: 'debugger.paused',
  content: {
    reason: 'exception' | 'promiseRejection' | 'breakpoint' | 'debuggerStatement' | 'step' | 'capture',
    message?: string,      // exception description or capture label
    stack: StackFrame[],
    url: string,
    timestamp: number,
    scopes: ScopeFrame[]
  }
}
```
