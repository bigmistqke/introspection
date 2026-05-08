# Limits of prototype patching

Several Introspection plugins capture page activity by wrapping global methods on built-in prototypes (e.g. `Storage.prototype.setItem`, the Redux DevTools extension globals, `IDBObjectStore.prototype.put`). This note describes the one realistic gap that applies to all such plugins, so individual plugin READMEs can link here instead of restating it.

## The mechanism

When a plugin runs an `addInitScript` to overwrite a method on a built-in prototype, the patch is applied **per realm**. Playwright's `addInitScript` runs in the main frame and in every navigated iframe, so each of those realms gets its prototype patched before any page script executes. Calls to the wrapped method via `obj.method(...)`, `Proto.method.call(obj, ...)`, `Reflect.apply`, or DevTools console input all hit the wrapper.

## The gap: realm-crossing through non-navigating iframes

Each browsing context has its own JavaScript realm with its own copy of every built-in prototype. Frames that **don't navigate** — `about:blank` and `srcdoc` iframes — do not trigger Playwright's `addInitScript`, so their prototypes are *not* patched.

A page can therefore borrow a clean reference from a non-navigating iframe and apply it to the parent's object:

```js
const f = document.createElement('iframe')
document.body.appendChild(f) // about:blank, no navigation, no init script

// f.contentWindow.Storage.prototype.setItem is the unpatched native method.
// Calling it with parent's localStorage as the receiver mutates parent storage
// without going through the parent's wrapper.
f.contentWindow.Storage.prototype.setItem.call(localStorage, 'key', 'value')
```

The mutation happens, but our wrapper never sees it.

## Why we don't fix it

Real application code never does this. The technique is a known security/devtools curiosity — used by some sandbox libraries to obtain "clean" native references — but normal app code uses normal call sites, all of which are caught.

If a future use case actually needs to close the gap, the natural mitigation is a parallel CDP-based capture (e.g. `DOMStorage` for storage plugins, `IndexedDB` for IndexedDB) running as a *leak detector* — it doesn't emit per-mutation events itself (the wrapper handles those, with correct timestamps), but it warns when CDP observes a mutation the wrapper didn't.

## Plugins this applies to

- `@introspection/plugin-redux` — patches the Redux DevTools extension globals.
- `@introspection/plugin-web-storage` — patches `Storage.prototype`.
- `@introspection/plugin-indexeddb` (planned) — will patch `IDBObjectStore.prototype` and friends.
- Any future plugin that wraps page globals.

Each plugin README should include a one-line caveat linking here.
