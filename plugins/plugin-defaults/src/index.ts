import type { IntrospectionPlugin } from '@introspection/types'
import { network } from '@introspection/plugin-network'
import { jsError } from '@introspection/plugin-js-error'
import { debuggerPlugin } from '@introspection/plugin-debugger'
import { consolePlugin } from '@introspection/plugin-console'

export interface DefaultsOptions {
  verbose?: boolean
}

export function defaults(options?: DefaultsOptions): IntrospectionPlugin[] {
  return [network(options), jsError(options), debuggerPlugin(options), consolePlugin(options)]
}
