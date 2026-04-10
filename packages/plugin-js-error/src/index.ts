import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import { normaliseCdpJsError } from '@introspection/core'
import './event-types.js'

export type { JsErrorEvent } from './event-types.js'

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
        const errorEvent = normaliseCdpJsError(
          { exceptionDetails: parameters.exceptionDetails, timestamp: Date.now() / 1000 } as Record<string, unknown>,
          0,
        )
        ctx.emit(errorEvent)
      })
    },
  }
}
