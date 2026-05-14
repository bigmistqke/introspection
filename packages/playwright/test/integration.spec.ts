import { test, expect } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

test('withIntrospect produces a run dir, run meta, and a per-test session with steps', () => {
  const base = mkdtempSync(join(tmpdir(), 'introspect-e2e-'))

  execFileSync(
    'pnpm',
    ['exec', 'playwright', 'test', '--config', 'test/fixtures/withintrospect/playwright.config.ts'],
    {
      cwd: packageRoot,
      env: { ...process.env, INTROSPECT_DIR: base, INTROSPECT_RUN_ID: 'e2e-run' },
      stdio: 'inherit',
    },
  )

  const runDir = join(base, 'e2e-run')

  // run meta
  const runMeta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf-8'))
  expect(runMeta.id).toBe('e2e-run')
  expect(runMeta.status).toBe('passed')
  expect(runMeta.endedAt).toBeDefined()

  // exactly one per-test session directory
  const sessionDirs = readdirSync(runDir).filter((e) => e !== 'meta.json')
  expect(sessionDirs.length).toBe(1)
  expect(sessionDirs[0]).toMatch(/^default__/)

  // session meta carries status + project
  const sessionMeta = JSON.parse(readFileSync(join(runDir, sessionDirs[0], 'meta.json'), 'utf-8'))
  expect(sessionMeta.status).toBe('passed')
  expect(sessionMeta.project).toBe('default')

  // events include test lifecycle + a captured step
  const events = readFileSync(join(runDir, sessionDirs[0], 'events.ndjson'), 'utf-8')
    .trim().split('\n').map((line) => JSON.parse(line))
  expect(events.some((e) => e.type === 'test.start')).toBe(true)
  expect(events.some((e) => e.type === 'test.end')).toBe(true)
  expect(events.some((e) => e.type === 'step.start')).toBe(true)

  rmSync(base, { recursive: true, force: true })
})
