# @introspection/plugin-defaults

Convenience package that exports the default plugin composition for introspection.

## Install

```bash
pnpm add -D @introspection/plugin-defaults
```

## Usage

```ts
import { attach } from '@introspection/playwright'
import { defaults } from '@introspection/plugin-defaults'

const handle = await attach(page, { plugins: defaults() })
```

## What's included

`defaults()` returns `[network(), jsError(), debuggerPlugin(), consolePlugin()]` — the standard set for most tests.
