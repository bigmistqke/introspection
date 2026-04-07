import type { IntrospectionPlugin } from '@introspection/types'
import { network } from './network.js'
import { jsErrors } from './js-errors.js'
import type { JsErrorsOptions } from './js-errors.js'

export interface DefaultsOptions {
  jsErrors?: JsErrorsOptions
}

export function defaults(opts?: DefaultsOptions): IntrospectionPlugin[] {
  return [network(), jsErrors(opts?.jsErrors)]
}
