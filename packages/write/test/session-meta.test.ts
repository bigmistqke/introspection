import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createSessionWriter } from '../src/session.js'

describe('session meta project + status', () => {
  it('writes project at init and status at finalize', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'introspect-write-'))
    const writer = await createSessionWriter({ outDir, id: 'sess', project: 'browser-mobile' })
    await writer.finalize({ status: 'failed' })

    const meta = JSON.parse(readFileSync(join(outDir, 'sess', 'meta.json'), 'utf-8'))
    expect(meta.project).toBe('browser-mobile')
    expect(meta.status).toBe('failed')
    expect(meta.endedAt).toBeDefined()
    rmSync(outDir, { recursive: true, force: true })
  })
})
