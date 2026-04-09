import type { IntrospectionPlugin } from '@introspection/types'
import { network } from '@introspection/plugin-network'
import { jsError } from '@introspection/plugin-js-error'
import { debuggerPlugin } from '@introspection/plugin-debugger'

export function defaults(): IntrospectionPlugin[] {
  return [network(), jsError(), debuggerPlugin()]
}
