# @introspection/plugin-debugger

Introspection plugin that captures debugger pauses with scope locals and call stack information.

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
import { attach, defaults } from '@introspection/playwright'
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

## What it captures

When the debugger pauses (due to exception, breakpoint, or step), it collects:

- **Scopes** — local variables from up to 5 call frames, up to 3 scopes each, 20 properties per scope
- **Stack** — full call stack with source-mapped URLs and line numbers
- **Reason** — why the debugger paused (`exception`, `promiseRejection`, `breakpoint`, `debuggerStatement`, `step`)

## Assets written

```ts
{
  kind: 'scopes',
  trigger: 'debugger.paused',
  content: {
    reason: 'exception' | 'promiseRejection' | 'breakpoint' | 'debuggerStatement' | 'step',
    message?: string,
    stack: StackFrame[],
    url: string,
    timestamp: number,
    scopes: ScopeFrame[]
  }
}
```
