import { createDebug } from '@introspection/core'
import type { IntrospectionPlugin, PluginContext, BaseEvent } from '@introspection/types'

export type ConsoleLevel = 'log' | 'warn' | 'error' | 'info' | 'debug'

export interface ConsoleEvent extends BaseEvent {
  type: 'console'
  data: { level: ConsoleLevel; message: string }
}

declare module '@introspection/types' {
  interface TraceEventMap {
    'console': ConsoleEvent
  }
}

export interface ConsoleOptions {
  levels?: ConsoleLevel[]
  verbose?: boolean
}

export function consolePlugin(options?: ConsoleOptions): IntrospectionPlugin {
  const allowedLevels = options?.levels ?? ['log', 'warn', 'error', 'info', 'debug']
  const debug = createDebug('console', options?.verbose ?? false)

  function normaliseLevel(level: string): ConsoleLevel | undefined {
    if (level === 'warning') return 'warn'
    if (level === 'info' || level === 'debug' || level === 'log' || level === 'error') return level
    return undefined
  }

  return {
    name: 'console',
    description: 'Captures browser console output',
    events: {
      'console': 'Browser console log, warn, error, info, or debug',
    },

    async install(ctx: PluginContext): Promise<void> {
      await ctx.cdpSession.send('Runtime.enable')

      ctx.cdpSession.on('Runtime.consoleAPICalled', (rawParams) => {
        const params = rawParams as { type: string; args: Array<{ type: string; value?: string; description?: string }>; timestamp: number }

        debug('consoleAPICalled', params.type)

        const level = normaliseLevel(params.type)
        if (!level || !allowedLevels.includes(level)) return

        const message = params.args.map(a => a.value ?? a.description ?? '').join(' ')

        ctx.emit({
          source: 'plugin',
          type: 'console',
          timestamp: ctx.timestamp(),
          data: { level, message },
        })
      })
    },
  }
}
