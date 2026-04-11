import { createDebug } from '@introspection/utils'
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import './event-types.js'
import type { ConsoleLevel } from './event-types.js'

export type { ConsoleLevel, ConsoleEvent } from './event-types.js'

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
