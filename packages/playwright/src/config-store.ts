import type { IntrospectionPlugin, IntrospectionReporter } from '@introspection/types'

export type IntrospectMode = 'on' | 'retain-on-failure' | 'on-first-retry'

export interface StoredIntrospectConfig {
  plugins: IntrospectionPlugin[]
  reporters: IntrospectionReporter[]
  mode: IntrospectMode
}

let stored: StoredIntrospectConfig | undefined

/** Called by withIntrospect in every process that evaluates playwright.config.ts. */
export function setIntrospectConfig(config: StoredIntrospectConfig): void {
  stored = config
}

/** Read by the worker auto-fixture and by globalTeardown. */
export function getIntrospectConfig(): StoredIntrospectConfig | undefined {
  return stored
}
