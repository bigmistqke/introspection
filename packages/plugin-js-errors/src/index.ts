import type { IntrospectionPlugin, PluginContext, ScopeFrame } from '@introspection/types'
import { normaliseCdpJsError, takeSnapshot } from '@introspection/core'

// Augment BusPayloadMap so the 'js.error' trigger is typed.
// External consumers (e.g. webgl plugin) import this module to get the augmented type.
declare module '@introspection/types' {
  interface BusPayloadMap {
    'js.error': { trigger: 'js.error'; timestamp: number; message: string }
  }
}

export interface JsErrorsOptions {
  /** Whether to pause on all exceptions or only uncaught ones. Default: 'uncaught' */
  pauseOnExceptions?: 'all' | 'uncaught'
}

export function jsErrors(opts?: JsErrorsOptions): IntrospectionPlugin {
  const pauseState = opts?.pauseOnExceptions ?? 'uncaught'

  return {
    name: 'js-errors',
    description: 'Captures uncaught exceptions and unhandled rejections with scope locals and DOM snapshots',
    events: {
      'js.error': 'Uncaught exception or unhandled rejection',
      'js.error.paused': 'Debugger paused on exception — includes scope locals from call stack',
    },
    options: {
      pauseOnExceptions: {
        description: 'Whether to pause on "all" exceptions or only "uncaught" ones',
        value: pauseState,
      },
    },

    async install(ctx: PluginContext): Promise<void> {
      await ctx.cdpSession.send('Debugger.enable')
      await ctx.cdpSession.send('Debugger.setPauseOnExceptions', { state: pauseState })

      ctx.cdpSession.on('Runtime.exceptionThrown', (rawParams) => {
        const parameters = rawParams as { exceptionDetails: Record<string, unknown> }

        void (async () => {
          const errorEvent = normaliseCdpJsError(
            { exceptionDetails: parameters.exceptionDetails, timestamp: Date.now() / 1000 } as Record<string, unknown>,
            0,
          )
          ctx.emit(errorEvent)

          const url = await ctx.cdpSession.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true })
            .then((r) => ((r as { result: { value?: string } }).result.value ?? ''))
            .catch(() => '')

          const snapshot = await takeSnapshot({
            cdpSession: { send: (method, params) => ctx.cdpSession.send(method, params) },
            trigger: 'js.error',
            url,
            callFrames: [],
          })

          await ctx.writeAsset({
            kind: 'snapshot',
            content: JSON.stringify(snapshot),
            metadata: {
              timestamp: ctx.timestamp(),
              trigger: 'js.error',
              url: snapshot.url,
              scopeCount: 0,
            },
          })

          await ctx.bus.emit('js.error', {
            trigger: 'js.error',
            timestamp: ctx.timestamp(),
            message: String(errorEvent.data.message ?? ''),
          })
        })()
      })

      ctx.cdpSession.on('Debugger.paused', (rawParams) => {
        const parameters = rawParams as {
          reason: string
          data?: Record<string, unknown>
          callFrames?: Array<{
            functionName: string
            url: string
            location: { lineNumber: number; columnNumber?: number }
            scopeChain: Array<{ type: string; object: { objectId?: string } }>
          }>
        }

        if (!['exception', 'promiseRejection'].includes(parameters.reason)) {
          void ctx.cdpSession.send('Debugger.resume').catch(() => {})
          return
        }

        void (async () => {
          // Collect scope locals while the debugger is still paused
          const scopes: ScopeFrame[] = []
          for (const frame of (parameters.callFrames ?? []).slice(0, 5)) {
            const locals: Record<string, unknown> = {}
            for (const scope of frame.scopeChain.slice(0, 3)) {
              if (!scope.object.objectId) continue
              try {
                const { result: scopeProperties } = await ctx.cdpSession.send('Runtime.getProperties', {
                  objectId: scope.object.objectId, ownProperties: true,
                }) as { result: Array<{ name: string; value?: { type?: string; value?: unknown; description?: string; objectId?: string } }> }
                for (const property of scopeProperties.slice(0, 20)) {
                  const propValue = property.value
                  if (!propValue) { locals[property.name] = undefined; continue }
                  locals[property.name] = propValue.value ?? propValue.description ?? undefined
                }
              } catch { /* non-fatal */ }
            }
            scopes.push({
              frame: `${frame.functionName || '(anonymous)'} (${frame.url}:${frame.location.lineNumber + 1})`,
              locals,
            })
          }

          // Resume before any page.evaluate / CDP evaluate calls
          await ctx.cdpSession.send('Debugger.resume').catch(() => {})

          // Build a synthetic exceptionDetails object compatible with normaliseCdpJsError
          const syntheticParams = {
            timestamp: Date.now() / 1000,
            exceptionDetails: {
              text: '',
              exception: parameters.data ?? {},
              stackTrace: {
                callFrames: (parameters.callFrames ?? []).map(frame => ({
                  functionName: frame.functionName,
                  url: frame.url,
                  lineNumber: frame.location.lineNumber,
                  columnNumber: frame.location.columnNumber ?? 0,
                })),
              },
            },
          }

          const errorEvent = normaliseCdpJsError(syntheticParams as Record<string, unknown>, 0)
          ctx.emit({ ...errorEvent, type: 'js.error.paused' })

          const url = await ctx.cdpSession.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true })
            .then((r) => ((r as { result: { value?: string } }).result.value ?? ''))
            .catch(() => '')

          const snapshot = await takeSnapshot({
            cdpSession: { send: (method, params) => ctx.cdpSession.send(method, params) },
            trigger: 'js.error.paused',
            url,
            callFrames: [],
          })
          const mergedSnapshot = { ...snapshot, scopes }

          await ctx.writeAsset({
            kind: 'snapshot',
            content: JSON.stringify(mergedSnapshot),
            metadata: {
              timestamp: ctx.timestamp(),
              trigger: 'js.error.paused',
              url: mergedSnapshot.url,
              scopeCount: mergedSnapshot.scopes.length,
            },
          })
        })()
      })
    },
  }
}
