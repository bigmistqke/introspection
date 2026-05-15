import { test, expect } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  detectGitInfo, writeRunMeta, readRunMeta, scanTraceMetas, computeAggregateStatus,
} from '../src/run-meta.js'

test('detectGitInfo prefers env overrides', () => {
  const info = detectGitInfo({ INTROSPECT_RUN_BRANCH: 'feat', INTROSPECT_RUN_COMMIT: 'deadbeef' })
  expect(info).toEqual({ branch: 'feat', commit: 'deadbeef' })
})

test('writeRunMeta / readRunMeta round-trip', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'introspect-runmeta-'))
  await writeRunMeta(dir, { version: '1', id: 'r1', startedAt: 5 })
  expect(await readRunMeta(dir)).toEqual({ version: '1', id: 'r1', startedAt: 5 })
  rmSync(dir, { recursive: true, force: true })
})

test('scanTraceMetas reads each trace dir status, ignoring meta.json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'introspect-scan-'))
  writeFileSync(join(dir, 'meta.json'), '{}')
  for (const [name, status] of [['a', 'passed'], ['b', 'failed']] as const) {
    mkdirSync(join(dir, name))
    writeFileSync(join(dir, name, 'meta.json'), JSON.stringify({ version: '2', id: name, startedAt: 0, status }))
  }
  const scanned = await scanTraceMetas(dir)
  expect(scanned.sort((x, y) => x.dir.localeCompare(y.dir)))
    .toEqual([{ dir: 'a', status: 'passed' }, { dir: 'b', status: 'failed' }])
  rmSync(dir, { recursive: true, force: true })
})

test('computeAggregateStatus is failed if any trace failed', () => {
  expect(computeAggregateStatus(['passed', 'skipped'])).toBe('passed')
  expect(computeAggregateStatus(['passed', 'timedOut'])).toBe('failed')
  expect(computeAggregateStatus([])).toBe('passed')
})
