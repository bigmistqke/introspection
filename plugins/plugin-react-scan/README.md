# React Plugin

Captures React component renders and reconciler commits, via [react-scan](https://github.com/aidenybai/react-scan).

## Events

| Event | Description |
|-------|-------------|
| `react.render` | Component render (mount or update), per commit, with timing and change metadata |
| `react.commit` | Reconciler commit phase boundary (`phase: 'start' \| 'finish'`) |

## Usage

```typescript
import { attach } from '@introspection/playwright'
import { reactScanPlugin } from '@introspection/plugin-react-scan'

const handle = await attach(page, {
  plugins: [reactScanPlugin()],
  outDir: '.introspect',
})
```

The plugin must be registered before the page navigates to the React app — `attach()` runs the plugin's script via `page.addInitScript()`, which executes before any page script on each navigation.

## Options

- `verbose` (boolean): Enable verbose debug logging.

## Event shapes

### `react.render`

```typescript
{
  type: 'react.render',
  timestamp: number,
  metadata: {
    component: string         // from react-scan `Render.componentName`
    phase: 'mount' | 'update' | 'unmount'
    duration: number | null   // ms; react-scan `Render.time`
    count: number             // renders of this component in the current commit
    unnecessary: boolean | null
  }
}
```

### `react.commit`

```typescript
{
  type: 'react.commit',
  timestamp: number,
  metadata: { phase: 'start' | 'finish' }
}
```

## How it works

The plugin bundles [react-scan](https://github.com/aidenybai/react-scan) + a thin adapter into a single IIFE (`dist/browser.global.js`), which is injected into the page via `page.addInitScript()` before React loads. react-scan installs the React DevTools hook, instruments the reconciler, and calls our `onRender` / `onCommitStart` / `onCommitFinish` callbacks — we push each event through the shared `window.__introspect_push__` CDP binding.

Maintaining React internals (fiber walking, version compat, hook installation) is out of scope; that responsibility lives in react-scan.
