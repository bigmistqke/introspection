/**
 * plugin-cdp monkey-patches the shared CDPSession to observe every outgoing
 * command and every incoming event. Install it **first** in your `plugins`
 * array so its tap is in place before other plugins issue CDP commands.
 * Framework-internal commands during attach() setup (Runtime.enable,
 * DOM.enable, Page.enable, Runtime.addBinding) fire before any plugin
 * installs and are not captured.
 */
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import { createDebug } from '@introspection/utils'

export type { CdpCommandEvent, CdpEventEvent } from '@introspection/types'

export interface CdpOptions {
  verbose?: boolean
  /** Include resolved command results in cdp.command events. Results can be large (Runtime.evaluate payloads, network bodies), so set false to keep traces small. Default true. */
  captureResults?: boolean
  /** Return true for methods you want captured. Applied to both commands and events. Default: all methods. */
  filter?: (method: string) => boolean
}

export function cdp(options?: CdpOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-cdp', options?.verbose ?? false)
  const captureResults = options?.captureResults ?? true
  const filter = options?.filter

  return {
    name: 'cdp',
    description: 'Captures every CDP command and event that crosses the wire',
    events: {
      'cdp.command': 'Outgoing CDP command with its resolved result or error',
      'cdp.event': 'Incoming CDP event (wildcard — fires for every method)',
    },

    async install(ctx: PluginContext): Promise<void> {
      debug('install: patching shared CDPSession')
      const trace = ctx.rawCdpTrace

      // CDPSession extends EventEmitter at runtime, but Playwright's public
      // type surface hides that — cast to an emit-bearing shape.
      const emitter = trace as unknown as {
        send: (method: string, params?: Record<string, unknown>) => Promise<unknown>
        emit: (method: string | symbol, ...args: unknown[]) => boolean
      }

      const originalSend = emitter.send.bind(emitter)
      emitter.send = async (method: string, params?: Record<string, unknown>) => {
        const start = Date.now()
        try {
          const result = await originalSend(method, params)
          if (!filter || filter(method)) {
            debug('command', method, `${Date.now() - start}ms`)
            ctx.emit({
              type: 'cdp.command',
              metadata: {
                method,
                params,
                ...(captureResults && result !== undefined ? { result } : {}),
                durationMs: Date.now() - start,
              },
            })
          }
          return result
        } catch (error) {
          if (!filter || filter(method)) {
            debug('command error', method, String(error))
            ctx.emit({
              type: 'cdp.command',
              metadata: {
                method,
                params,
                error: String(error),
                durationMs: Date.now() - start,
              },
            })
          }
          throw error
        }
      }

      const originalEmit = emitter.emit.bind(emitter)
      emitter.emit = function(method, ...args) {
        if (typeof method === 'string' && (!filter || filter(method))) {
          debug('event', method)
          ctx.emit({ type: 'cdp.event', metadata: { method, params: args[0] } })
        }
        return originalEmit(method, ...args)
      }
    },
  }
}
