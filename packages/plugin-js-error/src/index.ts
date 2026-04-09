import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import { normaliseCdpJsError } from '@introspection/core'

// Augment BusPayloadMap so the 'js.error' trigger is typed.
// External consumers (e.g. webgl plugin) import this module to get the augmented type.
declare module '@introspection/types' {
  interface BusPayloadMap {
    'js.error': { trigger: 'js.error'; timestamp: number; message: string }
  }
}

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

        void (async () => {
          const errorEvent = normaliseCdpJsError(
            { exceptionDetails: parameters.exceptionDetails, timestamp: Date.now() / 1000 } as Record<string, unknown>,
            0,
          )
          ctx.emit(errorEvent)

          await ctx.bus.emit('js.error', {
            trigger: 'js.error',
            timestamp: ctx.timestamp(),
            message: String(errorEvent.data.message ?? ''),
          })
        })()
      })
    },
  }
}
