import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createSessionWriter } from '../src/index.js'
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
    const writer = await createSessionWriter({ outDir, id: 's', reporters: [reporter] })
    await writer.emit({ type: 'mark', metadata: { label: 'a' } })
    await writer.emit({ type: 'mark', metadata: { label: 'b' } })
    await writer.flush()
    expect(seen).toEqual(['mark', 'mark'])
  })

  it('calls onSessionStart exactly once with a populated context', async () => {
    const calls: ReporterContext[] = []
    const reporter: IntrospectionReporter = {
      name: 'capture',
      onSessionStart(ctx) { calls.push(ctx) },
    }
    await createSessionWriter({ outDir, id: 'sess', reporters: [reporter] })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.sessionId).toBe('sess')
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
    const writer = await createSessionWriter({ outDir, id: 's', reporters: [reporter] })
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
    const writer = await createSessionWriter({ outDir, id: 's', reporters: [reporter] })
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

  it('calls onSessionEnd exactly once when finalize() runs', async () => {
    let count = 0
    const reporter: IntrospectionReporter = { name: 'capture', onSessionEnd() { count++ } }
    const writer = await createSessionWriter({ outDir, id: 's', reporters: [reporter] })
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
    const writer = await createSessionWriter({ outDir, id: 's', reporters: [reporter] })
    await writer.emit({ type: 'mark', metadata: { label: 'outside' } })
    await writer.flush()
    expect(seen).toHaveLength(0)
    expect(events).toEqual(['mark'])
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
    const writer = await createSessionWriter({ outDir, id: 's-async', reporters: [reporter] })
    await writer.emit({ type: 'mark', metadata: { label: 'm' } })
    // Crucial: if flush() does NOT wait for tracked work, `seen` will still be empty here.
    await writer.flush()
    expect(seen).toEqual(['mark'])
  })
})
