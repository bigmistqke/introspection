import type { IntrospectionPlugin, PluginContext } from '@introspection/types'

export type ConsoleLevel = 'log' | 'warn' | 'error' | 'info' | 'debug'

export interface ConsoleOptions {
  levels?: ConsoleLevel[]
}

export function consolePlugin(options?: ConsoleOptions): IntrospectionPlugin {
  const allowedLevels = options?.levels ?? ['log', 'warn', 'error', 'info', 'debug']

  return {
    name: 'console',
    description: 'Captures browser console output',
    events: {
      'console': 'Browser console log, warn, error, info, or debug',
    },

    async install(ctx: PluginContext): Promise<void> {
      await ctx.cdpSession.send('Log.enable')

      ctx.cdpSession.on('Log.entryAdded', (rawParams) => {
        const entry = (rawParams as { entry: { level: string; text: string; args?: unknown[]; timestamp: number } }).entry

        if (!allowedLevels.includes(entry.level as ConsoleLevel)) return

        ctx.emit({
          source: 'plugin',
          type: 'console',
          timestamp: ctx.timestamp(),
          data: {
            level: entry.level,
            message: entry.text,
            args: entry.args?.map(a => String(a)),
          },
        })
      })
    },
  }
}
