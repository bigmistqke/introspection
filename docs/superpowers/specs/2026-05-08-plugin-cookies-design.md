# `plugin-cookies` — Design

Captures cookie activity into the introspection trace: page-side writes via `document.cookie` and the `CookieStore` API, plus full cookie snapshots at install and on bus triggers.

Sibling to `plugin-web-storage` and `plugin-indexeddb`. Follows the same playbook: page-side prototype patching, single CDP binding for events, server-side CDP for snapshots, `origins: ['*']` default with overrideable filter.

## Why

Auth and session bugs are constant pain points and rarely visible in network logs alone — apps set cookies via `document.cookie`, the browser sets them via `Set-Cookie` response headers, and SameSite/Secure/HttpOnly attribute interactions surprise people. With `plugin-network` already capturing `Set-Cookie` headers, this plugin closes the remaining gaps: page-side mutations and full cookie state at moments of interest.

## Scope

In scope:
- `document.cookie =` writes (and deletions, expressed as set-with-expired-date).
- `CookieStore.set` / `CookieStore.delete` (Chromium async API).
- Cookie snapshots at install + bus triggers (`manual`, `js.error`, `detach`).

Out of scope (separate / future):
- HTTP `Set-Cookie` headers — already in `plugin-network` response events.
- Cookie reads — `document.cookie` returns all cookies as one string, low signal-to-noise. `CookieStore.get` is per-key but rarely used in practice. Easy to add later if it turns out to matter.
- Cookie store sync events (`CookieStore.addEventListener('change')`) — covered by our write capture for cookies the page sets, and by `plugin-network` for Set-Cookie. Browser-internal mutations aren't a real concern in test contexts.
- HTTP-only / Secure / SameSite *enforcement* events — only visible when a request is blocked, which `plugin-network` already exposes via `requestWillBeSentExtraInfo` blocking reasons.

## Public API

```ts
import { cookies } from '@introspection/plugin-cookies'

attach(page, {
  plugins: [
    cookies(),                                      // writes + snapshots
    cookies({ names: ['session', 'auth-token'] }),  // restrict to specific cookie names
    cookies({ origins: ['https://app.example.com'] }), // restrict to cookies for these hostnames
  ],
})
```

```ts
interface CookiesOptions {
  /**
   * Restrict capture to cookies whose domain matches one of these origins'
   * hostnames. Default: ['*'] (all cookies). Match semantics: cookie domain
   * `.example.com` matches origin hostname `app.example.com`; cookie domain
   * `app.example.com` matches origin hostname `app.example.com` exactly.
   */
  origins?: string[]
  /**
   * Restrict capture to cookies with these names. Default: all. Useful for
   * focusing on auth / session cookies and ignoring tracking noise.
   */
  names?: string[]
  verbose?: boolean
}
```

Defaults: writes + snapshots; all origins; all cookie names.

## Event schema

Two event types added to `@introspection/types`.

```ts
// Shared subtype used by snapshots.
export interface CookieEntry {
  name: string
  value: string
  domain: string
  path: string
  /** Unix seconds. Absent for session cookies. */
  expires?: number
  httpOnly: boolean
  secure: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  /** CHIPS partition key, present when the cookie is partitioned. */
  partitionKey?: string
}

export interface CookieWriteEvent extends BaseEvent {
  type: 'cookie.write'
  metadata: {
    operation: 'set' | 'delete'
    source: 'document.cookie' | 'CookieStore'
    /** Origin of the page realm that made the call. */
    origin: string
    name: string
    /** Present for 'set'; absent for 'delete'. */
    value?: string
    /** Explicit attributes, where the caller specified them. */
    domain?: string
    path?: string
    expires?: number
    httpOnly?: boolean
    secure?: boolean
    sameSite?: 'Strict' | 'Lax' | 'None'
    /**
     * Raw cookie string for document.cookie writes (useful for debugging
     * parser surprises). Absent for CookieStore writes.
     */
    raw?: string
  }
}

export interface CookieSnapshotEvent extends BaseEvent {
  type: 'cookie.snapshot'
  metadata: {
    trigger: 'install' | 'manual' | 'js.error' | 'detach'
    origin: string
    cookies: CookieEntry[]
  }
}
```

Cookie payloads are tiny (4KB per origin is the browser-enforced max), so snapshots are inlined in metadata — no asset round-trip. Matches `plugin-web-storage`.

A `delete` event is emitted when:
- `document.cookie = "k=; expires=Thu, 01 Jan 1970 00:00:00 GMT"` (or any past date)
- `document.cookie = "k=; max-age=0"` (or negative)
- `CookieStore.delete(name)` is called

The page-side patch decides between `set` and `delete` based on the parsed expiry; the resulting event reflects the apparent intent rather than the literal write.

## Capture mechanism

All ongoing capture is **page-side**. Snapshots use server-side CDP. Single binding channel. Same architecture as the storage plugins.

### Page-side prototype patches

Installed via `Page.addScriptToEvaluateOnNewDocument` (covers all future navigations and frames) and `Runtime.evaluate` (covers the realm at install time).

**`Document.prototype.cookie` setter:**

`document.cookie` is an accessor property on `Document.prototype` (declared in WebIDL). We replace its descriptor:

```js
var origDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
if (origDesc && origDesc.set) {
  Object.defineProperty(Document.prototype, 'cookie', {
    configurable: true,
    enumerable: origDesc.enumerable,
    get: origDesc.get,                           // unchanged — reads aren't captured
    set: function(raw) {
      origDesc.set.call(this, raw);              // do the write first
      try {
        var parsed = parseCookieString(String(raw));
        var op = isExpired(parsed) ? 'delete' : 'set';
        emit({
          kind: 'write', source: 'document.cookie',
          operation: op, name: parsed.name, value: parsed.value,
          domain: parsed.domain, path: parsed.path,
          expires: parsed.expires, secure: parsed.secure,
          sameSite: parsed.sameSite, raw: String(raw),
        });
      } catch (_) { /* parse failed — emit minimal event with raw only */ }
    },
  });
}
```

The parser handles standard cookie attributes: `expires`, `max-age`, `domain`, `path`, `secure`, `samesite`, `httponly`. Unknown attributes are ignored.

**`CookieStore.prototype.set` / `delete`:**

```js
if (typeof CookieStore !== 'undefined') {
  var origSet = CookieStore.prototype.set;
  CookieStore.prototype.set = function(nameOrOpts, value) {
    var p = origSet.apply(this, arguments);
    var fields = typeof nameOrOpts === 'object' ? nameOrOpts : { name: nameOrOpts, value: value };
    p.then(function() {
      emit({
        kind: 'write', source: 'CookieStore', operation: 'set',
        name: String(fields.name), value: fields.value === undefined ? undefined : String(fields.value),
        domain: fields.domain, path: fields.path, expires: fields.expires,
        sameSite: fields.sameSite,
      });
    }).catch(function() { /* page handles its own errors */ });
    return p;
  };

  var origDel = CookieStore.prototype.delete;
  CookieStore.prototype.delete = function(nameOrOpts) {
    var p = origDel.apply(this, arguments);
    var name = typeof nameOrOpts === 'object' ? nameOrOpts.name : nameOrOpts;
    p.then(function() {
      emit({ kind: 'write', source: 'CookieStore', operation: 'delete', name: String(name) });
    }).catch(function() {});
    return p;
  };
}
```

Both async paths emit on settle so failures don't appear as successful writes.

### Snapshots — server-side via CDP

```
const { cookies } = await cdpSession.send('Network.getAllCookies') as {
  cookies: Array<{
    name: string; value: string; domain: string; path: string;
    expires: number; size: number;
    httpOnly: boolean; secure: boolean; session: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
    partitionKey?: string;
  }>
}
```

`Network.getAllCookies` returns *every* cookie in the browser context, including HttpOnly. We then apply origin and name filters before emitting. The CDP `expires` field is unix seconds; `-1` means session — we omit `expires` in that case.

### Origin and name filters

**Origin filter** matches cookie domains against origin hostnames using browser cookie matching rules:

```ts
function cookieDomainMatchesOrigin(cookieDomain: string, originHost: string): boolean {
  // Cookie domain may have leading dot. After stripping, compare:
  //   - exact match (cookieDomain === originHost), or
  //   - originHost ends with '.' + cookieDomain (subdomain match).
  const d = cookieDomain.replace(/^\./, '')
  return originHost === d || originHost.endsWith('.' + d)
}
```

When `origins` includes `'*'`, the filter is bypassed (all cookies pass).

**Name filter** is a straightforward `names.includes(cookie.name)`. Bypassed when undefined.

Both filters are applied to snapshots and to write events (writes are filtered by origin = page realm and name = parsed cookie name).

### Bus subscriptions

```ts
ctx.bus.on('manual',   () => snapshotOnce('manual'))
ctx.bus.on('js.error', () => snapshotOnce('js.error'))
ctx.bus.on('detach',   () => snapshotOnce('detach'))
```

Same pattern as the other capture plugins. Will migrate to the unified `'snapshot'` trigger when `docs/superpowers/plans/2026-05-08-snapshot-bus-trigger-refactor.md` lands.

## Package layout

```
plugins/plugin-cookies/
├── package.json
├── playwright.config.ts
├── README.md
├── src/index.ts          // exports cookies(options); server-side handler + filters + snapshots
├── src/page-script.ts    // BROWSER_SCRIPT — Document.cookie + CookieStore patches + parser
├── test/
│   ├── *.spec.ts         // Playwright integration tests
│   └── fixtures/
└── tsconfig.json
```

The page script splits into its own file because the cookie-string parser is non-trivial and reads as page-realm code, not Node code. Mirrors the layout of `plugin-indexeddb`.

## Testing

Playwright integration tests against an HTTP fixture (cookies don't behave well on `file://` — there's no host). The fixture can be served via `page.route('**/*', ...)` like `plugin-console`'s tests do.

- Pre-existing cookies set via `page.context().addCookies(...)` → install snapshot includes them with correct domain, secure, sameSite.
- `document.cookie = 'a=1'` → one `cookie.write` (set, source: 'document.cookie').
- `document.cookie = 'a=; max-age=0'` → one `cookie.write` (delete).
- Multi-attribute write `'b=2; path=/sub; secure; samesite=strict'` → metadata reflects every attribute.
- (when `CookieStore` exists) `cookieStore.set('c', '3')` and `cookieStore.delete('c')` → one event each, source: 'CookieStore'.
- `js.error` mid-test → cookie snapshot with `trigger: 'js.error'`.
- `names: ['session']` filter → only cookies named `session` appear in writes and snapshots.
- `origins: ['https://other.example']` filter → cookies for the test origin are excluded.
- HttpOnly cookie set via `page.context().addCookies` → present in snapshot (CDP sees through HttpOnly).

## Risks / open questions

- **`document.cookie` is a getter/setter, and the descriptor lives on the prototype as an accessor.** Standard browsers (Chromium, Firefox) expose it that way. Our patch checks `origDesc.set` exists before replacing. If the descriptor is not configurable or not present, we no-op and emit a `introspect.warning` event. Realistic browsers don't trip this.
- **Cookie attribute parsing.** We implement a minimal RFC 6265-style parser sufficient for the standard attributes. Edge cases: cookies with embedded `;` in values (rare and non-standard), case sensitivity in attribute names (we lowercase), comma-separated `Set-Cookie` values (not relevant — we're parsing what the page wrote, not server output). If the parser fails for a write, we emit a minimal event with `raw` only.
- **Origin attribution for writes.** The page-side wrapper records `location.origin` at the time of the write. Cookies set this way actually scope to a *domain*, but the origin tells consumers which page made the call.
- **CookieStore browser support.** Chromium-only at time of writing. The patch wraps it conditionally — Firefox/Safari users get document.cookie capture only. No fallback needed.
- **Realm-crossing limit** — the page-script + non-navigating-iframe trick applies as it does to every prototype-patching plugin in this repo: see `docs/prototype-patching-limits.md`.

## Related work

- `plugins/plugin-network` — captures `Set-Cookie` headers via `Network.responseReceivedExtraInfo`. Consumers wanting full cookie observability join `network.response` events with `cookie.snapshot`.
- `docs/superpowers/specs/2026-05-08-plugin-web-storage-design.md` — sibling pattern.
- `docs/superpowers/specs/2026-05-08-plugin-indexeddb-design.md` — sibling pattern.
- `docs/superpowers/plans/2026-05-08-snapshot-bus-trigger-refactor.md` — eventual unification of bus snapshot triggers.
- `docs/superpowers/plans/2026-05-08-origins-option.md` — eventual framework-level `origins` config.
- `docs/prototype-patching-limits.md` — shared note on realm-crossing; linked from README.
