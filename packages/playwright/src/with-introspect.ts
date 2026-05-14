import { fileURLToPath } from 'url'
import type { PlaywrightTestConfig } from '@playwright/test'
import type { IntrospectionPlugin, IntrospectionReporter } from '@introspection/types'
import { setIntrospectConfig, type IntrospectMode } from './config-store.js'

export interface WithIntrospectOptions {
  plugins: IntrospectionPlugin[]
  reporters?: IntrospectionReporter[]
  mode?: IntrospectMode
}

// Resolved relative to this module. In the built package this module is
// dist/index.js (with-introspect is bundled into it), so these resolve to
// dist/global-setup.js / dist/global-teardown.js — both emitted as their own
// tsup entries. At source-test time they resolve to the .ts siblings.
const SETUP_PATH = fileURLToPath(new URL('./global-setup.js', import.meta.url))
const TEARDOWN_PATH = fileURLToPath(new URL('./global-teardown.js', import.meta.url))

function toArray(value: string | string[] | undefined): string[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Wraps a Playwright config: stashes plugins/reporters/mode in the module
 * singleton (read again in every worker, since Playwright re-evaluates the
 * config file per worker) and composes introspection's globalSetup /
 * globalTeardown around the project's own via Playwright's array form.
 */
export function withIntrospect(
  config: PlaywrightTestConfig,
  options: WithIntrospectOptions,
): PlaywrightTestConfig {
  setIntrospectConfig({
    plugins: options.plugins,
    reporters: options.reporters ?? [],
    mode: options.mode ?? 'on',
  })
  return {
    ...config,
    globalSetup: [SETUP_PATH, ...toArray(config.globalSetup)],
    globalTeardown: [...toArray(config.globalTeardown), TEARDOWN_PATH],
  }
}
