import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import { createDebug, normaliseCdpJsError } from '@introspection/utils'

export type { JsErrorEvent } from '@introspection/types'

export interface JsErrorOptions {
  verbose?: boolean
}

export function jsError(options?: JsErrorOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-js-error', options?.verbose ?? false)
  return {
    name: 'js-error',
    description: 'Captures JS exceptions and unhandled promise rejections',
    events: {
      'js.error': 'JS exception or unhandled promise rejection',
    },

    async install(ctx: PluginContext): Promise<void> {
      debug('installing')
      ctx.cdpSession.on('Runtime.exceptionThrown', (rawParams) => {
        const parameters = rawParams as { exceptionDetails: Record<string, unknown> }
        debug('exception thrown', { url: parameters.exceptionDetails })
        ctx.emit(normaliseCdpJsError({ exceptionDetails: parameters.exceptionDetails } as Record<string, unknown>))
      })
    },

    formatEvent(event) {
      if (event.type !== 'js.error') return null
      return event.metadata.message
    },
  }
}
