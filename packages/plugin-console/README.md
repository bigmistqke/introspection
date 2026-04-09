# @introspection/plugin-console

Captures browser console output (`log`, `warn`, `error`, `info`, `debug`) via CDP's `Log` domain.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [Options](#options)
- [What it emits](#what-it-emits)

## Install

```bash
pnpm add -D @introspection/plugin-console
```

## Usage

```ts
import { attach } from '@introspection/playwright'
import { consolePlugin } from '@introspection/plugin-console'

const handle = await attach(page, { plugins: [consolePlugin()] })
```

## Options

```ts
consolePlugin({
  levels: ['log', 'warn', 'error']  // default: all levels
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `levels` | `ConsoleLevel[]` | `['log', 'warn', 'error', 'info', 'debug']` | Which console levels to capture |

## What it emits

| Event type | Description |
|---|---|
| `console` | Console method invocation |

```ts
{
  type: 'console',
  source: 'plugin',
  data: {
    level: 'log' | 'warn' | 'error' | 'info' | 'debug',
    message: string,
    args?: string[]
  }
}
```
