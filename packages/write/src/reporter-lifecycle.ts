import type { IntrospectionReporter, ReporterContext, TraceEvent, SessionBus, TestEndInfo, TestStartInfo, PayloadAsset, TestStartEvent, TestEndEvent } from '@introspection/types'

interface ActiveTest {
  info: TestStartInfo
  events: TraceEvent[]
}

export interface ReporterRunner {
  start(): Promise<void>
  handleEvent(event: TraceEvent): void
  end(): Promise<void>
}

function flattenAssets(events: TraceEvent[]): PayloadAsset[] {
  const out: PayloadAsset[] = []
  for (const event of events) {
    if (!event.payloads) continue
    for (const key of Object.keys(event.payloads)) {
      const payload = event.payloads[key]
      if (payload && payload.kind === 'asset') out.push(payload)
    }
  }
  return out
}

function asEndStatus(raw: string): TestEndInfo['status'] {
  if (raw === 'passed' || raw === 'failed' || raw === 'timedOut' || raw === 'skipped' || raw === 'interrupted') return raw
  return 'failed'
}

export function createReporterRunner(
  reporters: IntrospectionReporter[],
  ctx: ReporterContext,
  bus: SessionBus,
): ReporterRunner {
  void bus
  let active: ActiveTest | null = null

  function deliverTestStart(event: TestStartEvent) {
    const info: TestStartInfo = {
      testId: event.id,
      label: event.metadata.label,
      titlePath: event.metadata.titlePath,
      startedAt: event.timestamp,
    }
    // Any in-flight buffer is discarded: nested test.start is not possible in Playwright's model.
    active = { info, events: [event] }
    for (const reporter of reporters) {
      if (!reporter.onTestStart) continue
      const result = reporter.onTestStart(info, ctx)
      if (result instanceof Promise) ctx.track(() => result)
    }
  }

  function deliverTestEnd(event: TestEndEvent) {
    if (!active) return
    active.events.push(event)
    const info: TestEndInfo = {
      ...active.info,
      endedAt: event.timestamp,
      duration: event.metadata.duration,
      status: asEndStatus(event.metadata.status),
      error: event.metadata.error,
      events: active.events,
      assets: flattenAssets(active.events),
    }
    active = null
    for (const reporter of reporters) {
      if (!reporter.onTestEnd) continue
      const result = reporter.onTestEnd(info, ctx)
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
      } else if (event.type === 'test.end') {
        deliverTestEnd(event)
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
