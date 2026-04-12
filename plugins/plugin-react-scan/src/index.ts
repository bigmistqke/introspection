import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createDebug } from '@introspection/utils'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'

export interface ReactScanOptions {
  verbose?: boolean
}

export interface ReactScanReport {
  [componentKey: string]: { count: number; time: number; displayName: string | null }
}

export interface ReactScanPlugin extends IntrospectionPlugin {
  /**
   * Fetch react-scan's aggregate render report from the page.
   * Emits a `react-scan.report` event and returns the report.
   * Must be called after `install()` (i.e. after `attach()` completes).
   */
  report(): Promise<ReactScanReport | null>
}

const browserBundlePath = fileURLToPath(new URL('../dist/browser.global.js', import.meta.url))
const browserBundle = readFileSync(browserBundlePath, 'utf-8')

export function reactScanPlugin(options?: ReactScanOptions): ReactScanPlugin {
  const debug = createDebug('plugin-react-scan', options?.verbose ?? false)
  let ctx: PluginContext | undefined

  return {
    name: 'react-scan',
    description: 'Captures React component renders and commits via react-scan',
    events: {
      'react-scan.render': 'Component render (mount or update)',
      'react-scan.commit': 'Reconciler commit phase boundary',
      'react-scan.report': 'Aggregate render report returned by react-scan.getReport()',
    },
    script: browserBundle,
    async install(installCtx: PluginContext): Promise<void> {
      ctx = installCtx
      debug('react-scan plugin installed')
    },
    async report(): Promise<ReactScanReport | null> {
      if (!ctx) throw new Error('reactScanPlugin.report() called before install()')
      const result = await ctx.cdpSession.send('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__introspect_react_scan_report__?.() ?? null)',
        returnByValue: true,
      }) as { result: { value: string } }
      const report = JSON.parse(result.result.value) as ReactScanReport | null
      await ctx.emit({
        type: 'react-scan.report',
        timestamp: ctx.timestamp(),
        metadata: { report },
      })
      return report
    },
  }
}
