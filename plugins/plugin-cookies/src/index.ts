import { createDebug } from '@introspection/utils'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import { BROWSER_SCRIPT } from './page-script.js'

export type {
  CookieEntry,
  CookieWriteEvent,
  CookieHttpEvent,
  CookieSnapshotEvent,
} from '@introspection/types'

export interface CookiesOptions {
  /** Restrict capture to cookies whose domain matches one of these origins'
   *  hostnames. Default: ['*']. */
  origins?: string[]
  /** Restrict capture to cookies with these names. Default: all. */
  names?: string[]
  verbose?: boolean
}

export function cookies(options?: CookiesOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-cookies', options?.verbose ?? false)
  const origins = options?.origins ?? ['*']
  const names = options?.names

  return {
    name: 'cookies',
    description: 'Captures cookie activity (programmatic writes, HTTP Set-Cookie, snapshots)',
    events: {
      'cookie.write': 'Programmatic cookie mutation (document.cookie / CookieStore)',
      'cookie.http': 'Cookie set by an HTTP response Set-Cookie header',
      'cookie.snapshot': 'Full cookie state at install and on bus triggers',
    },
    async install(_ctx: PluginContext): Promise<void> {
      debug('installing', { origins, names })
      void BROWSER_SCRIPT
    },
  }
}
