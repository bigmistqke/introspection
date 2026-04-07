import type { IntrospectionPlugin } from '@introspection/types'
import { network } from '@introspection/plugin-network'
import { jsErrors } from '@introspection/plugin-js-errors'
import type { JsErrorsOptions } from '@introspection/plugin-js-errors'

export interface DefaultsOptions {
  jsErrors?: JsErrorsOptions
}

export function defaults(opts?: DefaultsOptions): IntrospectionPlugin[] {
  return [network(), jsErrors(opts?.jsErrors)]
}
