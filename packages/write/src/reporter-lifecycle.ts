import type { IntrospectionReporter, ReporterContext, TraceEvent, TraceBus, TestEndInfo, TestStartInfo, PayloadAsset, TestStartEvent, TestEndEvent } from '@introspection/types'

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
    for (const payload of Object.values(event.payloads)) {
      if (payload.kind === 'asset') out.push(payload)
    }
  }
  return out
}

function asEndStatus(raw: string): TestEndInfo['status'] {
  if (raw === 'passed' || raw === 'failed' || raw === 'timedOut' || raw === 'skipped' || raw === 'interrupted') return raw
  // Treat unrecognised status strings as failures rather than throwing.
  return 'failed'
}

export function createReporterRunner(
  reporters: IntrospectionReporter[],
  ctx: ReporterContext,
  bus: TraceBus,
): ReporterRunner {
  let active: ActiveTest | null = null
  const disabled = new Set<IntrospectionReporter>()

  function reportFailure(reporter: IntrospectionReporter, method: string, cause: unknown) {
    disabled.add(reporter)
    const error = cause instanceof Error ? cause : new Error(String(cause))
    void bus.emit('introspect:warning', {
      error: {
        name: error.name,
        message: error.message,
        source: 'reporter',
        cause,
        stack: error.stack,
        reporterName: reporter.name,
        method,
      },
    })
  }

  function invoke<T>(
    reporter: IntrospectionReporter,
    method: string,
    call: () => T | Promise<T>,
  ): void {
    if (disabled.has(reporter)) return
    let result: T | Promise<T>
    try {
      result = call()
    } catch (cause) {
      reportFailure(reporter, method, cause)
      return
    }
    if (result instanceof Promise) {
      ctx.track(() => result.then(() => undefined, (cause) => { reportFailure(reporter, method, cause) }))
    }
  }

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
      invoke(reporter, 'onTestStart', () => reporter.onTestStart!(info, ctx))
    }
  }

  function dispatchTestEnd(info: TestEndInfo) {
    for (const reporter of reporters) {
      if (!reporter.onTestEnd) continue
      invoke(reporter, 'onTestEnd', () => reporter.onTestEnd!(info, ctx))
    }
  }

  function deliverTestEnd(event: TestEndEvent) {
    if (!active) {
      void bus.emit('introspect:warning', {
        error: {
          name: 'OrphanTestEnd',
          message: 'test.end emitted with no matching test.start',
          source: 'reporter',
        },
      })
      return
    }
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
    dispatchTestEnd(info)
  }

  return {
    async start() {
      for (const reporter of reporters) {
        if (!reporter.onTraceStart) continue
        invoke(reporter, 'onTraceStart', () => reporter.onTraceStart!(ctx))
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
        invoke(reporter, 'onEvent', () => reporter.onEvent!(event, ctx))
      }
    },
    async end() {
      if (active) {
        const events = active.events
        const lastTimestamp = events[events.length - 1]?.timestamp ?? active.info.startedAt
        const info: TestEndInfo = {
          ...active.info,
          endedAt: lastTimestamp,
          status: 'interrupted',
          events,
          assets: flattenAssets(events),
        }
        active = null
        dispatchTestEnd(info)
      }
      for (const reporter of reporters) {
        if (!reporter.onTraceEnd) continue
        invoke(reporter, 'onTraceEnd', () => reporter.onTraceEnd!(ctx))
      }
    },
  }
}
