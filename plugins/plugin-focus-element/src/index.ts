import BROWSER_SCRIPT from '../dist/browser.iife.js'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import { createDebug } from '@introspection/utils'

export interface FocusElementOptions {
  origins?: (string | RegExp)[]
  verbose?: boolean
}

export function focusElement(options?: FocusElementOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-focus-element', options?.verbose ?? false)
  const originsConfig = serialiseOrigins(options?.origins)
  return {
    name: 'focus-element',
    description: 'Captures every focus transition (shadow DOM, iframes, programmatic call sites)',
    events: {
      'focus.changed': 'Focus moved between elements (or left/entered the document)',
    },
    script: `var __introspect_focus_config__=${originsConfig};${BROWSER_SCRIPT}`,
    async install(_context: PluginContext): Promise<void> {
      debug('installing', { origins: options?.origins ?? null })
    },
  }
}

function serialiseOrigins(origins: (string | RegExp)[] | undefined): string {
  if (!origins) return 'null'
  const entries = origins.map((entry) =>
    entry instanceof RegExp
      ? `{ kind: 'regex', source: ${JSON.stringify(entry.source)}, flags: ${JSON.stringify(entry.flags)} }`
      : `{ kind: 'string', value: ${JSON.stringify(entry)} }`
  )
  return `[${entries.join(',')}]`
}
