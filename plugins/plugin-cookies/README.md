# @introspection/plugin-cookies

Captures cookie activity into the introspection trace: programmatic page-side writes (via `document.cookie` and `CookieStore`), HTTP `Set-Cookie` response headers, and full cookie snapshots at install + bus triggers.

The plugin patches `Document.prototype.cookie` setter and `CookieStore.prototype` page-side, and subscribes to CDP `Network.responseReceivedExtraInfo` server-side for HTTP-set cookies. Snapshots use `Network.getAllCookies` so HttpOnly cookies are visible.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [Options](#options)
- [Events emitted](#events-emitted)
- [How HTTP Set-Cookie joins to network events](#how-http-set-cookie-joins-to-network-events)
- [Caveats](#caveats)

## Install

```bash
pnpm add -D @introspection/plugin-cookies
```

## Usage

```ts
import { attach } from '@introspection/playwright'
import { cookies } from '@introspection/plugin-cookies'

const handle = await attach(page, {
  plugins: [
    cookies(),                                        // all cookies, all origins
    // cookies({ names: ['session', 'auth-token'] }) // restrict by name
    // cookies({ origins: ['https://app.example.com'] }) // restrict by host
  ],
})
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `origins` | `string[]` | `['*']` | Restrict to cookies whose domain matches one of these origins' hostnames (RFC 6265 domain-match semantics). The literal `'*'` matches everything. |
| `names` | `string[]` | all | Restrict to cookies with these names. Useful for focusing on auth/session cookies. |
| `verbose` | `boolean` | `false` | Verbose debug logs. |

## Events emitted

- **`cookie.write`** — programmatic mutation from the page. `source: 'document.cookie' | 'CookieStore'`. Includes parsed attributes and the original `raw` string for `document.cookie` writes.
- **`cookie.http`** — cookie set by an HTTP `Set-Cookie` response header. Includes `url` and `requestId` (joinable to `network.response`). Always carries the raw header.
- **`cookie.snapshot`** — full cookie state. `metadata.trigger` is one of `'install' | 'manual' | 'js.error' | 'detach'`. Snapshots see HttpOnly cookies via CDP.

A `'delete'` operation is emitted when an attribute makes the cookie expired (`max-age=0`, or `expires` in the past), or when `CookieStore.delete` is called.

## How HTTP Set-Cookie joins to network events

The `requestId` field on `cookie.http` events is the same CDP request ID used by `plugin-network`. To pair a cookie with the response that set it:

```bash
# Get a cookie.http event's requestId
introspect events --type cookie.http | jq '.metadata.requestId'

# Find the matching response
introspect events --type network.response | jq 'select(.metadata.cdpRequestId == "<ID>")'
```

Run `plugin-cookies` and `plugin-network` together for full visibility — the duplication is intentional (the same Set-Cookie header is observable as a parsed `cookie.http` event and as a raw header on `network.response`).

## Caveats

The plugin captures programmatic writes by patching `Document.prototype.cookie` and `CookieStore.prototype`. This is robust against every realistic call site, but has the same realm-crossing limitation as every prototype-patching plugin in this repo: see [`docs/prototype-patching-limits.md`](../../docs/prototype-patching-limits.md). The HTTP capture path (CDP-based) is unaffected.

`document.cookie` reads are not captured — the getter returns *all* cookies as one string, so a read tells you the page peeked but not which key it cared about. Snapshots provide full state instead.

`CookieStore` is Chromium-only at time of writing; on Firefox/Safari only `document.cookie` writes are captured.
