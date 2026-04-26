# @introspection/config

Shared config loading and plugin preset resolution for the introspection toolchain. Used by `@introspection/playwright` and `@introspection/cli`.

## API

### `loadPlugins(opts?) => Promise<IntrospectionPlugin[]>`

Sugar: find the nearest `introspect.config.{ts,mts,js,mjs}`, apply precedence rules, return the plugin array.

```ts
import { attach } from '@introspection/playwright'
import { loadPlugins } from '@introspection/config'

await attach(page, { plugins: await loadPlugins() })
```

Options:

| field | default | notes |
|---|---|---|
| `cwd` | `process.cwd()` | starting point for upward discovery |
| `configPath` | undefined | explicit path; errors if not found |
| `env` | `process.env` | source for `INTROSPECT_PRESET` |
| `optsPlugins` | undefined | passthrough override; skips config load |

### `loadIntrospectConfig(opts?) => Promise<IntrospectConfig | undefined>`

Pure loader. Walks up from `cwd` (or loads `configPath` directly). Returns `undefined` if nothing found on the discovery path. Throws on an explicit `configPath` that doesn't exist.

### `resolvePlugins(args) => IntrospectionPlugin[]`

Pure precedence logic. Takes `{ optsPlugins?, config?, env }` and applies:

1. `optsPlugins` — returned verbatim if provided.
2. `env.INTROSPECT_PRESET` — selects preset(s) from object-form config. Comma-separated values merge.
3. Array-form config — returned verbatim when no env preset is set.
4. Object-form config's `default` preset.
5. `[]`.

Errors:
- `INTROSPECT_PRESET` set with no config → throws.
- `INTROSPECT_PRESET` set with array-form config → throws.
- Unknown preset name → throws with available names.

## Config file shapes

**Array form** (single always-active set):

```ts
// introspect.config.ts
import { network } from '@introspection/plugin-network'
import type { IntrospectConfig } from '@introspection/types'

export default {
  plugins: [network()],
} satisfies IntrospectConfig
```

**Preset form** (`default` required):

```ts
import { network } from '@introspection/plugin-network'
import { jsError } from '@introspection/plugin-js-error'
import { redux } from '@introspection/plugin-redux'
import type { IntrospectConfig } from '@introspection/types'

export default {
  plugins: {
    default: [],
    network: [network(), jsError()],
    state:   [redux({ captureState: true }), jsError()],
  },
} satisfies IntrospectConfig
```

Select a preset per run:

```
INTROSPECT_PRESET=network pnpm test
INTROSPECT_PRESET=network,state pnpm test    # merges
```
