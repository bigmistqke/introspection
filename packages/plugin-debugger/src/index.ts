import type { IntrospectionPlugin, PluginContext, ScopeFrame, StackFrame } from '@introspection/types'

export interface DebuggerOptions {
  pauseOnExceptions?: 'all' | 'uncaught'
  breakpoints?: Array<{
    url: string
    line: number
    condition?: string
  }>
}

function normaliseStackFrame(frame: { functionName?: string; url?: string; lineNumber?: number; columnNumber?: number }): StackFrame {
  return {
    functionName: frame.functionName || '(anonymous)',
    file: frame.url || '',
    line: (frame.lineNumber ?? 0) + 1,
    column: (frame.columnNumber ?? 0) + 1,
  }
}

export function debuggerPlugin(options?: DebuggerOptions): IntrospectionPlugin {
  const pauseOnExceptions = options?.pauseOnExceptions ?? 'uncaught'

  return {
    name: 'debugger',
    description: 'Captures debugger pauses with scope locals and call stack',
    events: {
      'scopes': 'Debugger pause with collected scope locals',
    },
    options: {
      pauseOnExceptions: {
        description: 'Whether to pause on "all" exceptions or only "uncaught" ones',
        value: pauseOnExceptions,
      },
    },

    async install(ctx: PluginContext): Promise<void> {
      await ctx.cdpSession.send('Debugger.enable')
      await ctx.cdpSession.send('Debugger.setPauseOnExceptions', { state: pauseOnExceptions })

      for (const bp of options?.breakpoints ?? []) {
        await ctx.cdpSession.send('Debugger.setBreakpoint', {
          location: { url: bp.url, lineNumber: bp.line - 1 },
          condition: bp.condition,
        })
      }

      ctx.cdpSession.on('Debugger.paused', (rawParams) => {
        const params = rawParams as {
          reason: string
          data?: Record<string, unknown>
          callFrames?: Array<{
            functionName?: string
            url?: string
            location: { lineNumber?: number; columnNumber?: number }
            scopeChain: Array<{ type: string; object: { objectId?: string } }>
          }>
        }

        if (!['exception', 'promiseRejection', 'breakpoint', 'debuggerStatement', 'step'].includes(params.reason)) {
          void ctx.cdpSession.send('Debugger.resume').catch(() => {})
          return
        }

        void (async () => {
          const timestamp = ctx.timestamp()

          const stack: StackFrame[] = (params.callFrames ?? []).map(frame =>
            normaliseStackFrame({
              functionName: frame.functionName,
              url: frame.url,
              lineNumber: frame.location.lineNumber,
              columnNumber: frame.location.columnNumber,
            })
          )

          const scopes: ScopeFrame[] = []
          for (const frame of (params.callFrames ?? []).slice(0, 5)) {
            const locals: Record<string, unknown> = {}
            for (const scope of frame.scopeChain.slice(0, 3)) {
              if (!scope.object.objectId) continue
              try {
                const { result: scopeProperties } = await ctx.cdpSession.send('Runtime.getProperties', {
                  objectId: scope.object.objectId, ownProperties: true,
                }) as { result: Array<{ name: string; value?: { type?: string; value?: unknown; description?: string } }> }
                for (const property of scopeProperties.slice(0, 20)) {
                  const propValue = property.value
                  if (!propValue) { locals[property.name] = undefined; continue }
                  locals[property.name] = propValue.value ?? propValue.description ?? undefined
                }
              } catch { /* non-fatal */ }
            }
            scopes.push({
              frame: `${frame.functionName || '(anonymous)'} (${frame.url}:${(frame.location.lineNumber ?? 0) + 1})`,
              locals,
            })
          }

          await ctx.cdpSession.send('Debugger.resume').catch(() => {})

          const url = await ctx.cdpSession.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true })
            .then((r) => ((r as { result: { value?: string } }).result.value ?? ''))
            .catch(() => '')

          const message = params.reason === 'exception' || params.reason === 'promiseRejection'
            ? String((params.data as Record<string, unknown>)?.exceptionDescription ?? '')
            : undefined

          await ctx.writeAsset({
            kind: 'scopes',
            content: JSON.stringify({
              reason: params.reason,
              message,
              stack,
              url,
              timestamp,
              scopes,
            }),
            ext: 'json',
            metadata: {
              timestamp,
              trigger: 'debugger.paused',
              url,
              scopeCount: scopes.length,
            },
          })
        })()
      })
    },
  }
}
