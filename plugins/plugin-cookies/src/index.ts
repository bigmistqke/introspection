import { createDebug } from '@introspection/utils'
import type { IntrospectionPlugin, PluginContext, CookieEntry } from '@introspection/types'
import { BROWSER_SCRIPT } from './page-script.js'

export type {
  CookieEntry,
  CookieWriteEvent,
  CookieHttpEvent,
  CookieSnapshotEvent,
} from '@introspection/types'

export interface CookiesOptions {
  origins?: string[]
  names?: string[]
  verbose?: boolean
}

type SnapshotTrigger = 'install' | 'manual' | 'js.error' | 'detach'

interface CdpCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  size: number
  httpOnly: boolean
  secure: boolean
  session: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  partitionKey?: string
}

function cookieDomainMatchesOrigin(cookieDomain: string, originHost: string): boolean {
  const d = cookieDomain.replace(/^\./, '')
  return originHost === d || originHost.endsWith('.' + d)
}

export function cookies(options?: CookiesOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-cookies', options?.verbose ?? false)
  const origins = options?.origins ?? ['*']
  const namesFilter = options?.names

  function nameAllowed(name: string): boolean {
    if (!namesFilter) return true
    return namesFilter.includes(name)
  }

  function domainAllowed(domain: string): boolean {
    if (origins.includes('*')) return true
    return origins.some(o => {
      try { return cookieDomainMatchesOrigin(domain, new URL(o).hostname) }
      catch { return false }
    })
  }

  return {
    name: 'cookies',
    description: 'Captures cookie activity (programmatic writes, HTTP Set-Cookie, snapshots)',
    events: {
      'cookie.write': 'Programmatic cookie mutation (document.cookie / CookieStore)',
      'cookie.http': 'Cookie set by an HTTP response Set-Cookie header',
      'cookie.snapshot': 'Full cookie state at install and on bus triggers',
    },
    async install(ctx: PluginContext): Promise<void> {
      debug('installing', { origins, namesFilter })
      void BROWSER_SCRIPT // wired in Task 4

      let topOrigin: string | undefined

      try {
        await ctx.cdpSession.send('Page.enable')
        const frameTree = await ctx.cdpSession.send('Page.getFrameTree') as {
          frameTree: { frame: { url: string; securityOrigin?: string } }
        }
        const root = frameTree.frameTree.frame
        topOrigin = root.securityOrigin ?? (() => {
          try { return new URL(root.url).origin } catch { return undefined }
        })()
      } catch (err) {
        debug('failed to determine top origin', (err as Error).message)
      }

      ctx.cdpSession.on('Page.frameNavigated', (rawParams) => {
        const params = rawParams as { frame: { id: string; parentId?: string; url: string; securityOrigin?: string } }
        if (params.frame.parentId) return
        topOrigin = params.frame.securityOrigin ?? (() => {
          try { return new URL(params.frame.url).origin } catch { return undefined }
        })()
      })

      const BINDING_NAME = '__introspection_plugin_cookies'

      type WritePayload = {
        origin: string
        kind: 'write'
        source: 'document.cookie' | 'CookieStore'
        operation: 'set' | 'delete'
        name: string
        value?: string
        domain?: string
        path?: string
        expires?: number
        secure?: boolean
        sameSite?: 'Strict' | 'Lax' | 'None'
        raw?: string
      }

      type PagePayload = WritePayload

      function handlePagePayload(payload: PagePayload): void {
        if (payload.kind !== 'write') return
        if (!nameAllowed(payload.name)) return
        if (!origins.includes('*')) {
          let originHost: string | undefined
          try { originHost = new URL(payload.origin).hostname } catch { /* ignore */ }
          const allowed = originHost ? origins.some(o => {
            try { return new URL(o).hostname === originHost } catch { return false }
          }) : false
          if (!allowed) return
        }

        const md: {
          operation: 'set' | 'delete'
          source: 'document.cookie' | 'CookieStore'
          origin: string
          name: string
          value?: string
          domain?: string
          path?: string
          expires?: number
          secure?: boolean
          sameSite?: 'Strict' | 'Lax' | 'None'
          raw?: string
        } = {
          operation: payload.operation,
          source: payload.source,
          origin: payload.origin,
          name: payload.name,
        }
        if (payload.value !== undefined) md.value = payload.value
        if (payload.domain !== undefined) md.domain = payload.domain
        if (payload.path !== undefined) md.path = payload.path
        if (payload.expires !== undefined) md.expires = payload.expires
        if (payload.secure !== undefined) md.secure = payload.secure
        if (payload.sameSite !== undefined) md.sameSite = payload.sameSite
        if (payload.raw !== undefined) md.raw = payload.raw

        void ctx.emit({ type: 'cookie.write', metadata: md })
      }

      await ctx.cdpSession.send('Runtime.addBinding', { name: BINDING_NAME })
      ctx.cdpSession.on('Runtime.bindingCalled', (rawParams) => {
        const params = rawParams as { name: string; payload: string }
        if (params.name !== BINDING_NAME) return
        try {
          const payload = JSON.parse(params.payload) as PagePayload
          handlePagePayload(payload)
        } catch (err) {
          debug('binding parse error', (err as Error).message)
        }
      })

      await ctx.cdpSession.send('Page.addScriptToEvaluateOnNewDocument', {
        source: BROWSER_SCRIPT,
      })

      try {
        await ctx.cdpSession.send('Runtime.evaluate', {
          expression: BROWSER_SCRIPT,
          awaitPromise: false,
        })
      } catch (err) {
        debug('current-realm patch failed', (err as Error).message)
      }

      async function snapshotOnce(trigger: SnapshotTrigger): Promise<void> {
        let raw: CdpCookie[] = []
        try {
          const r = await ctx.cdpSession.send('Network.getAllCookies') as { cookies: CdpCookie[] }
          raw = r.cookies
        } catch (err) {
          debug('getAllCookies failed', (err as Error).message)
        }

        const filtered: CookieEntry[] = []
        for (const c of raw) {
          if (!domainAllowed(c.domain)) continue
          if (!nameAllowed(c.name)) continue
          const entry: CookieEntry = {
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            httpOnly: c.httpOnly,
            secure: c.secure,
          }
          if (c.expires > 0 && !c.session) entry.expires = c.expires
          if (c.sameSite) entry.sameSite = c.sameSite
          if (c.partitionKey) entry.partitionKey = c.partitionKey
          filtered.push(entry)
        }

        await ctx.emit({
          type: 'cookie.snapshot',
          metadata: { trigger, origin: topOrigin ?? '', cookies: filtered },
        })
      }

      await snapshotOnce('install')
    },
  }
}
