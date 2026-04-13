# plugin-react-scan

Captures React component renders and reconciler commits, via [react-scan](https://github.com/aidenybai/react-scan).

## Events

| Event | Description |
|-------|-------------|
| `react-scan.render` | Component render (mount or update), per commit |
| `react-scan.commit` | Reconciler commit phase boundary (`phase: 'start' \| 'finish'`) |
| `react-scan.report` | Aggregate render report, emitted when `plugin.report()` is called |

## Usage

```typescript
import { attach } from '@introspection/playwright'
import { reactScanPlugin } from '@introspection/plugin-react-scan'

const plugin = reactScanPlugin()

const handle = await attach(page, {
  plugins: [plugin],
  outDir: '.introspect',
})

await page.goto('http://localhost:3000')
// ...interact with the app...

// Pull a summary of every component's render count/time at any point:
const report = await plugin.report()
// Also emits a `react-scan.report` event to the trace.

await handle.detach()
```

The plugin must be registered before the page navigates to the React app — `attach()` runs the plugin's script via `page.addInitScript()`, which executes before any page script on each navigation.

## Options

- `verbose` (boolean): Enable verbose debug logging.

## Plugin methods

### `plugin.report(): Promise<Report | null>`

Evaluates `react-scan.getReport()` in the page, emits a `react-scan.report` event with the result, and returns the report. `Report` is `Record<string, { count, time, displayName }>` keyed by component.

## Event shapes

### `react-scan.render`

```typescript
{
  type: 'react-scan.render',
  timestamp: number,
  metadata: {
    component: string         // from react-scan `Render.componentName`
    phase: 'mount' | 'update' | 'unmount'
    duration: number | null   // ms; react-scan `Render.time`
    count: number             // renders of this component in the current commit
    unnecessary: boolean | null
    didCommit: boolean        // whether this render contributed to a commit
    forget: boolean           // whether React Compiler's "forget" optimization applied
    fps: number               // page FPS at render time
  }
}
```

### `react-scan.commit`

```typescript
{
  type: 'react-scan.commit',
  timestamp: number,
  metadata: { phase: 'start' | 'finish' }
}
```

### `react-scan.report`

```typescript
{
  type: 'react-scan.report',
  timestamp: number,
  metadata: {
    report: Record<string, {
      count: number
      time: number
      displayName: string | null
    }> | null
  }
}
```

## How it works

The plugin bundles [react-scan](https://github.com/aidenybai/react-scan) + a thin adapter into a single IIFE (`dist/browser.global.js`), which is injected into the page via `page.addInitScript()` before React loads. react-scan installs the React DevTools hook, instruments the reconciler, and calls our `onRender` / `onCommitStart` / `onCommitFinish` callbacks — we push each event through the shared `window.__introspect_push__` CDP binding.

Maintaining React internals (fiber walking, version compat, hook installation) is out of scope; that responsibility lives in react-scan.

## Architecture

This plugin is a **bundled injection**: `react-scan` communicates with React via the published `__REACT_DEVTOOLS_GLOBAL_HOOK__` global rather than sharing React's module state, so a self-contained copy observes the app's React correctly. We ship the devtool + adapter as a single IIFE and no user setup is needed. See [Plugin shapes: prior art](../../CONTRIBUTING.md#plugin-shapes-prior-art) for the full catalogue.
