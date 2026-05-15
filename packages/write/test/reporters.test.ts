import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceWriter } from '../src/index.js'
import type { IntrospectionReporter, ReporterContext, TestStartInfo, TestEndInfo } from '@introspection/types'

let outDir: string

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'introspect-reporter-'))
})

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true })
})

describe('reporter lifecycle', () => {
  it('calls onEvent for every emitted event, in emission order', async () => {
    const seen: string[] = []
    const reporter: IntrospectionReporter = {
      name: 'capture',
      onEvent(event) { seen.push(event.type) },
    }
    const writer = await createTraceWriter({ outDir, id: 's', reporters: [reporter] })
    await writer.emit({ type: 'mark', metadata: { label: 'a' } })
    await writer.emit({ type: 'mark', metadata: { label: 'b' } })
    await writer.flush()
    expect(seen).toEqual(['mark', 'mark'])
  })

  it('calls onTraceStart exactly once with a populated context', async () => {
    const calls: ReporterContext[] = []
    const reporter: IntrospectionReporter = {
      name: 'capture',
      onTraceStart(ctx) { calls.push(ctx) },
    }
    await createTraceWriter({ outDir, id: 'sess', reporters: [reporter] })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.traceId).toBe('sess')
    expect(calls[0]!.outDir).toBe(join(outDir, 'sess'))
    expect(calls[0]!.runDir).toBe(outDir)
    expect(calls[0]!.meta.id).toBe('sess')
  })

  it('calls onTestStart with titlePath and label when a test.start event is emitted', async () => {
    const seen: TestStartInfo[] = []
    const reporter: IntrospectionReporter = {
      name: 'capture',
      onTestStart(info) { seen.push(info) },
    }
    const writer = await createTraceWriter({ outDir, id: 's', reporters: [reporter] })
    await writer.emit({ type: 'test.start', metadata: { label: 'logs in', titlePath: ['auth', 'logs in'] } })
    await writer.flush()
    expect(seen).toHaveLength(1)
    expect(seen[0]!.label).toBe('logs in')
    expect(seen[0]!.titlePath).toEqual(['auth', 'logs in'])
    expect(typeof seen[0]!.testId).toBe('string')
    expect(typeof seen[0]!.startedAt).toBe('number')
  })

  it('calls onTestEnd with the event slice (inclusive) and flattened assets', async () => {
    const seen: TestEndInfo[] = []
    const reporter: IntrospectionReporter = {
      name: 'capture',
      onTestEnd(info) { seen.push(info) },
    }
    const writer = await createTraceWriter({ outDir, id: 's', reporters: [reporter] })
    await writer.emit({ type: 'test.start', metadata: { label: 't', titlePath: ['t'] } })
    await writer.emit({ type: 'mark', metadata: { label: 'a' } })
    await writer.emit({
      type: 'mark',
      metadata: { label: 'b' },
      payloads: { snapshot: { kind: 'asset', format: 'json', path: 's/assets/x.json' } },
    })
    await writer.emit({ type: 'test.end', metadata: { label: 't', titlePath: ['t'], status: 'passed', duration: 42 } })
    await writer.flush()
    expect(seen).toHaveLength(1)
    const info = seen[0]!
    expect(info.status).toBe('passed')
    expect(info.duration).toBe(42)
    expect(info.events.map(e => e.type)).toEqual(['test.start', 'mark', 'mark', 'test.end'])
    expect(info.assets).toHaveLength(1)
    expect(info.assets[0]!.path).toBe('s/assets/x.json')
  })

  it('calls onTraceEnd exactly once when finalize() runs', async () => {
    let count = 0
    const reporter: IntrospectionReporter = { name: 'capture', onTraceEnd() { count++ } }
    const writer = await createTraceWriter({ outDir, id: 's', reporters: [reporter] })
    await writer.finalize()
    expect(count).toBe(1)
  })

  it('does not deliver onTestEnd for events outside any test', async () => {
    const seen: TestEndInfo[] = [];
    const events: string[] = [];
    const reporter: IntrospectionReporter = {
      name: 'capture',
      onTestEnd(info) { seen.push(info) },
      onEvent(event) { events.push(event.type) },
    }
    const writer = await createTraceWriter({ outDir, id: 's', reporters: [reporter] })
    await writer.emit({ type: 'mark', metadata: { label: 'outside' } })
    await writer.flush()
    expect(seen).toHaveLength(0)
    expect(events).toEqual(['mark'])
  })

  it('disables a reporter after it throws and emits an introspect:warning', async () => {
    const goodEvents: string[] = []
    const badEvents: string[] = []
    const warnings: string[] = []
    const bad: IntrospectionReporter = {
      name: 'bad',
      onEvent(event) {
        badEvents.push(event.type)
        throw new Error('boom')
      },
    }
    const good: IntrospectionReporter = {
      name: 'good',
      onEvent(event) { goodEvents.push(event.type) },
    }
    const writer = await createTraceWriter({ outDir, id: 's', reporters: [bad, good] })
    writer.bus.on('introspect:warning', (w) => { warnings.push(w.error.reporterName ?? '') })
    await writer.emit({ type: 'mark', metadata: { label: 'a' } })
    await writer.emit({ type: 'mark', metadata: { label: 'b' } })
    await writer.flush()
    expect(badEvents).toEqual(['mark'])              // disabled after first throw
    expect(goodEvents).toEqual(['mark', 'mark'])     // unaffected
    expect(warnings).toContain('bad')
  })

  it('disables a reporter whose async onEvent rejects, and emits a warning', async () => {
    const goodEvents: string[] = []
    const badEvents: string[] = []
    const warnings: string[] = []
    const bad: IntrospectionReporter = {
      name: 'bad-async',
      async onEvent(event) {
        badEvents.push(event.type)
        await Promise.resolve()
        throw new Error('async boom')
      },
    }
    const good: IntrospectionReporter = {
      name: 'good',
      onEvent(event) { goodEvents.push(event.type) },
    }
    const writer = await createTraceWriter({ outDir, id: 's-async-reject', reporters: [bad, good] })
    writer.bus.on('introspect:warning', (w) => { warnings.push(w.error.reporterName ?? '') })
    await writer.emit({ type: 'mark', metadata: { label: 'a' } })
    await writer.flush()
    // After the first event's async rejection is flushed, 'bad-async' is disabled.
    await writer.emit({ type: 'mark', metadata: { label: 'b' } })
    await writer.flush()
    expect(badEvents).toEqual(['mark'])              // only the first event reached it
    expect(goodEvents).toEqual(['mark', 'mark'])     // good reporter unaffected
    expect(warnings).toContain('bad-async')
  })

  it('emits an introspect:warning when test.end arrives without a matching test.start', async () => {
    const warnings: Array<{ source: string; message: string }> = []
    const writer = await createTraceWriter({ outDir, id: 's', reporters: [] })
    writer.bus.on('introspect:warning', (w) => { warnings.push({ source: w.error.source, message: w.error.message }) })
    await writer.emit({ type: 'test.end', metadata: { label: 't', titlePath: ['t'], status: 'passed' } })
    await writer.flush()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.source).toBe('reporter')
    expect(warnings[0]!.message).toMatch(/test\.end/i)
    expect(warnings[0]!.message).toMatch(/no matching test\.start/i)
  })

  it('awaits async onEvent work via flush() (ctx.track wiring)', async () => {
    const seen: string[] = []
    const reporter: IntrospectionReporter = {
      name: 'async-capture',
      async onEvent(event) {
        // Force a real microtask hop so the work can only complete after flush awaits it.
        await new Promise(resolve => setTimeout(resolve, 5))
        seen.push(event.type)
      },
    }
    const writer = await createTraceWriter({ outDir, id: 's-async', reporters: [reporter] })
    await writer.emit({ type: 'mark', metadata: { label: 'm' } })
    // Crucial: if flush() does NOT wait for tracked work, `seen` will still be empty here.
    await writer.flush()
    expect(seen).toEqual(['mark'])
  })

  it('synthesizes an interrupted onTestEnd for a test still in flight when finalize runs', async () => {
    const seen: TestEndInfo[] = []
    const traceEnds: number[] = []
    const reporter: IntrospectionReporter = {
      name: 'capture',
      onTestEnd(info) { seen.push(info) },
      onTraceEnd() { traceEnds.push(Date.now()) },
    }
    const writer = await createTraceWriter({ outDir, id: 's-interrupt', reporters: [reporter] })
    await writer.emit({ type: 'test.start', metadata: { label: 'in-flight', titlePath: ['suite', 'in-flight'] } })
    await writer.emit({ type: 'mark', metadata: { label: 'a' } })
    // No test.end — finalize while the test is still open.
    await writer.finalize()

    expect(seen).toHaveLength(1)
    const info = seen[0]!
    expect(info.status).toBe('interrupted')
    expect(info.label).toBe('in-flight')
    expect(info.titlePath).toEqual(['suite', 'in-flight'])
    expect(info.events.map(e => e.type)).toEqual(['test.start', 'mark'])
    expect(typeof info.endedAt).toBe('number')
    // onTraceEnd still runs, and after the synthesized onTestEnd.
    expect(traceEnds).toHaveLength(1)
  })

  it('does not synthesize an interrupted onTestEnd when no test is in flight', async () => {
    const seen: TestEndInfo[] = []
    const reporter: IntrospectionReporter = {
      name: 'capture',
      onTestEnd(info) { seen.push(info) },
    }
    const writer = await createTraceWriter({ outDir, id: 's-clean', reporters: [reporter] })
    await writer.emit({ type: 'test.start', metadata: { label: 't', titlePath: ['t'] } })
    await writer.emit({ type: 'test.end', metadata: { label: 't', titlePath: ['t'], status: 'passed', duration: 5 } })
    await writer.finalize()
    // Exactly one onTestEnd — the real one. No phantom interrupted delivery.
    expect(seen).toHaveLength(1)
    expect(seen[0]!.status).toBe('passed')
  })
})
