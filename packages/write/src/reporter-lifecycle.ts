import type { IntrospectionReporter, ReporterContext, TraceEvent, SessionBus, TestEndInfo, TestStartInfo, PayloadAsset } from '@introspection/types'

// TraceEvent, TestEndInfo, TestStartInfo, PayloadAsset are kept for future tasks
export type { TraceEvent, TestEndInfo, TestStartInfo, PayloadAsset }

export interface ReporterRunner {
  start(): Promise<void>
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
    async end() {
      for (const reporter of reporters) {
        if (!reporter.onSessionEnd) continue
        await reporter.onSessionEnd(ctx)
      }
    },
  }
}
