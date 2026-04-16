import type { IntrospectionPlugin, PluginContext, StackFrame } from '@introspection/types'
import { createDebug, normaliseCdpJsError } from '@introspection/utils'

export type { JsErrorEvent } from '@introspection/types'

export interface JsErrorOptions {
  verbose?: boolean
}

function parseStackFrames(error: Error): StackFrame[] {
  const stack = error.stack?.split('\n') ?? []
  return stack.slice(1).map((line) => {
    const match = line.match(/at (.+?) \((.+?):(\d+):(\d+)\)/)
    return {
      functionName: match?.[1] ?? 'anonymous',
      file: match?.[2] ?? '',
      line: parseInt(match?.[3] ?? '0', 10),
      column: parseInt(match?.[4] ?? '0', 10),
    }
  }).filter((f) => f.file)
}

function normalisePlaywrightJsError(error: Error): { type: 'js.error'; metadata: { message: string; stack: StackFrame[] } } {
  return {
    type: 'js.error' as const,
    metadata: {
      message: error.message,
      stack: parseStackFrames(error),
    },
  }
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
      if (ctx.capabilities.hasExceptionDetails && ctx.cdpSession) {
        ctx.cdpSession.on('Runtime.exceptionThrown', (rawParams) => {
          const parameters = rawParams as { exceptionDetails: Record<string, unknown> }
          debug('exception thrown', { url: parameters.exceptionDetails })
          ctx.emit(normaliseCdpJsError({ exceptionDetails: parameters.exceptionDetails } as Record<string, unknown>))
        })
      } else {
        ctx.page.on('pageerror', (error) => {
          debug('pageerror', { message: error.message })
          ctx.emit(normalisePlaywrightJsError(error))
        })
      }
    },
  }
}
