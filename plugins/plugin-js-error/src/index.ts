import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import { normaliseCdpJsError } from '@introspection/utils'

export type { JsErrorEvent } from '@introspection/types'

export function jsError(): IntrospectionPlugin {
  return {
    name: 'js-error',
    description: 'Captures JS exceptions and unhandled promise rejections',
    events: {
      'js.error': 'JS exception or unhandled promise rejection',
    },

    async install(ctx: PluginContext): Promise<void> {
      ctx.cdpSession.on('Runtime.exceptionThrown', (rawParams) => {
        const parameters = rawParams as { exceptionDetails: Record<string, unknown> }
        ctx.emit(normaliseCdpJsError({ exceptionDetails: parameters.exceptionDetails } as Record<string, unknown>))
      })
    },
  }
}
