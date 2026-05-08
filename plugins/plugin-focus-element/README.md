# @introspection/plugin-focus-element

Tracks focus changes during a Playwright session — every `focusin`, every `.focus()` call, including shadow DOM and same-origin iframes.

## Install

```bash
pnpm add -D @introspection/plugin-focus-element
```

## Usage

```ts
import { attach } from '@introspection/playwright'
import { focusElement } from '@introspection/plugin-focus-element'

const handle = await attach(page, {
  outDir: './.introspect',
  plugins: [focusElement()],
})
```

## Events

| Type | Fires when |
|---|---|
| `focus.changed` | Focus moves between elements, or leaves/enters the document |

### `focus.changed` metadata

```ts
{
  target: ElementInfo | null,        // null when focus leaves document
  previous: ElementInfo | null,
  cause: 'programmatic' | 'unknown',
  callSite?: string,                 // raw stack, set when cause === 'programmatic'
  origin?: string,                   // location.origin; set only in sub-frames
}

ElementInfo {
  tag, id, classList, testid,
  role, accessibleName,              // implicit role + aria-label/labelledby/<label>/innerText
  text,                              // truncated innerText
  selector,                          // CSS path
  shadowPath: string[] | null,       // host selectors deepest-last
  backendNodeId: number | null,      // null in v1
}
```

## Options

```ts
focusElement({
  origins: ['http://localhost:3000', /\.myapp\.com$/],
  verbose: true,
})
```

- `origins` — restrict the plugin to frames whose `location.origin` matches. Strings are exact-match; RegExps are tested against `location.origin`. Default: all frames.
- `verbose` — debug logging via `createDebug`.

## Querying

```bash
introspect events --type focus.changed --format json
introspect events --type focus.changed --filter 'event.metadata.cause === "programmatic"' --format json
```

## Caveats

- **Cross-origin iframes** are not instrumented — they appear once as the `<iframe>` element on the parent's `focus.changed`, then go silent. (Tracked in `docs/superpowers/plans/2026-05-08-origins-option.md`.)
- **`backendNodeId`** is `null` in v1; obtaining it requires a CDP roundtrip per event and isn't worth the cost yet.
- **`callSite`** is the raw `Error().stack` string. The CLI/UI can resolve through source maps later — see how `plugin-js-error` normalises stacks.
- Patching `HTMLElement.prototype.focus`/`.blur` is observable to the page. Apps that themselves patch these methods will compose with ours fine (we call the original `apply()`), but apps that compare `HTMLElement.prototype.focus.toString()` will see a different string.
- Programmatic blurs that leave the document entirely are reported with `cause: 'unknown'` (the focusout-leaves-document path uses a microtask that runs after the patch's `try/finally` clears the flag). Programmatic *focus* calls and programmatic blurs that move focus to another element are correctly reported as `programmatic`.
