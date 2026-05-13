import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createSessionWriter } from '../src/index.js'
import type { IntrospectionReporter, ReporterContext } from '@introspection/types'

let outDir: string

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'introspect-reporter-'))
})

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true })
})

describe('reporter lifecycle', () => {
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
})
