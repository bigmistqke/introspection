import type { IntrospectionReporter, ReporterContext, TraceEvent, SessionBus, TestEndInfo, TestStartInfo, PayloadAsset, TestStartEvent } from '@introspection/types'

interface ActiveTest {
  info: TestStartInfo
  events: TraceEvent[]
}

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
  let active: ActiveTest | null = null

  function deliverTestStart(event: TestStartEvent) {
    const info: TestStartInfo = {
      testId: event.id,
      label: event.metadata.label,
      titlePath: event.metadata.titlePath,
      startedAt: event.timestamp,
    }
    active = { info, events: [event] }
    for (const reporter of reporters) {
      if (!reporter.onTestStart) continue
      const result = reporter.onTestStart(info, ctx)
      if (result instanceof Promise) ctx.track(() => result)
    }
  }

  return {
    async start() {
      for (const reporter of reporters) {
        if (!reporter.onSessionStart) continue
        await reporter.onSessionStart(ctx)
      }
    },
    handleEvent(event) {
      if (event.type === 'test.start') {
        deliverTestStart(event)
      } else if (active) {
        active.events.push(event)
      }
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
