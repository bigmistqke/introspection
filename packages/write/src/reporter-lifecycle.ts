import type { IntrospectionReporter, ReporterContext, TraceEvent, SessionBus, TestEndInfo, TestStartInfo, PayloadAsset } from '@introspection/types'

// TestEndInfo, TestStartInfo, PayloadAsset are kept for future tasks
export type { TestEndInfo, TestStartInfo, PayloadAsset }

export interface ReporterRunner {
  start(): Promise<void>
  handleEvent(event: TraceEvent): void
  end(): Promise<void>
}

export function createReporterRunner(
  reporters: IntrospectionReporter[],
  ctx: ReporterContext,
  bus: SessionBus,
): ReporterRunner {
  void bus // used by later tasks
  return {
    async start() {
      for (const reporter of reporters) {
        if (!reporter.onSessionStart) continue
        await reporter.onSessionStart(ctx)
      }
    },
    handleEvent(event) {
      for (const reporter of reporters) {
        if (!reporter.onEvent) continue
        const result = reporter.onEvent(event, ctx)
        if (result instanceof Promise) ctx.track(() => result)
      }
    },
    async end() {
      for (const reporter of reporters) {
        if (!reporter.onSessionEnd) continue
        await reporter.onSessionEnd(ctx)
      }
    },
  }
}
