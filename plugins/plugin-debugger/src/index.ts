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

    // Wraps the capture binding so the page hits `debugger;` immediately after
    // sending the label. Without this, Debugger.pause from Node arrives after
    // page JS has finished running and the pause never lands.
    script: `
      window.__introspect_plugin_debugger_capture__ = function(payload) {
        window.__introspect_plugin_debugger_capture_binding__(payload);
        debugger;
      };
    `,

    async install(ctx: PluginContext): Promise<void> {
      await ctx.cdpSession.send('Debugger.enable')
      await ctx.cdpSession.send('Debugger.setPauseOnExceptions', { state: pauseOnExceptions })
      await ctx.cdpSession.send('Runtime.addBinding', { name: '__introspect_plugin_debugger_capture_binding__' })

      for (const bp of options?.breakpoints ?? []) {
        await ctx.cdpSession.send('Debugger.setBreakpoint', {
          location: { url: bp.url, lineNumber: bp.line - 1 },
          condition: bp.condition,
        })
      }

      let pendingCaptureLabel: string | undefined

      ctx.cdpSession.on('Runtime.bindingCalled', (rawParams) => {
        const params = rawParams as { name: string; payload: string }
        if (params.name !== '__introspect_plugin_debugger_capture_binding__') return
        try {
          const { label } = JSON.parse(params.payload) as { label?: string }
          pendingCaptureLabel = label ?? ''
        } catch { /* ignore malformed payload */ }
      })

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

        // CDP reports both manual Debugger.pause() calls and `debugger;` statements
        // with reason 'other'. We disambiguate via pendingCaptureLabel.
        const isCapture = params.reason === 'other' && pendingCaptureLabel !== undefined
        const isDebuggerStatement = params.reason === 'other' && pendingCaptureLabel === undefined
        const validReasons = ['exception', 'promiseRejection', 'breakpoint', 'step']
        if (!isCapture && !isDebuggerStatement && !validReasons.includes(params.reason)) {
          void ctx.cdpSession.send('Debugger.resume').catch(() => {})
          return
        }

        ctx.track(async () => {
          const timestamp = ctx.timestamp()

          // Skip first frame if this was a capture call (the capture() function itself)
          const framesToSkip = isCapture ? 1 : 0
          const frames = params.callFrames ?? []

          const stack: StackFrame[] = frames.map(frame =>
            normaliseStackFrame({
              functionName: frame.functionName,
              url: frame.url,
              lineNumber: frame.location.lineNumber,
              columnNumber: frame.location.columnNumber,
            })
          )

          const scopes: ScopeFrame[] = []
          for (const frame of frames.slice(framesToSkip, framesToSkip + 5)) {
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

          let message: string | undefined
          if (params.reason === 'exception' || params.reason === 'promiseRejection') {
            message = String((params.data as Record<string, unknown>)?.description ?? '')
          } else if (isCapture) {
            message = pendingCaptureLabel
            pendingCaptureLabel = undefined
          }

          const reason = isCapture ? 'capture' : isDebuggerStatement ? 'debuggerStatement' : params.reason
          const asset = await ctx.writeAsset({
            kind: 'json',
            content: JSON.stringify({
              reason,
              message,
              stack,
              url,
              timestamp,
              scopes,
            }),
            ext: 'json',
          })
          ctx.emit({
            type: 'debugger.capture' as const,
            assets: [asset],
          })
        })
      })
    },
  }
}
