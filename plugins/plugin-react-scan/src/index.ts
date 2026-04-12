import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createDebug } from '@introspection/utils'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'

export interface ReactScanOptions {
  verbose?: boolean
}

const browserBundlePath = fileURLToPath(new URL('../dist/browser.global.js', import.meta.url))
const browserBundle = readFileSync(browserBundlePath, 'utf-8')

export function reactScanPlugin(options?: ReactScanOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-react-scan', options?.verbose ?? false)

  return {
    name: 'react-scan',
    description: 'Captures React component renders and commits via react-scan',
    events: {
      'react.render': 'Component render (mount or update)',
      'react.commit': 'Reconciler commit phase boundary',
    },
    script: browserBundle,
    async install(_ctx: PluginContext): Promise<void> {
      debug('react-scan plugin installed')
    },
  }
}
