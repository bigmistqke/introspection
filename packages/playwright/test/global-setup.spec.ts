import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import introspectGlobalSetup from '../src/global-setup.js'

test('creates the run dir, writes RunMeta, exports RUN_DIR', async () => {
  const base = mkdtempSync(join(tmpdir(), 'introspect-setup-'))
  const env = { INTROSPECT_DIR: base, INTROSPECT_RUN_ID: 'run1', INTROSPECT_RUN_BRANCH: 'b', INTROSPECT_RUN_COMMIT: 'c' } as NodeJS.ProcessEnv

  await introspectGlobalSetup(env)

  const runDir = join(base, 'run1')
  expect(env.RUN_DIR).toBe(runDir)
  const meta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf-8'))
  expect(meta).toMatchObject({ version: '1', id: 'run1', branch: 'b', commit: 'c' })
  expect(typeof meta.startedAt).toBe('number')
  rmSync(base, { recursive: true, force: true })
})

test('does nothing when INTROSPECT_TRACING=0', async () => {
  const base = mkdtempSync(join(tmpdir(), 'introspect-setup-off-'))
  const env = { INTROSPECT_DIR: base, INTROSPECT_RUN_ID: 'run1', INTROSPECT_TRACING: '0' } as NodeJS.ProcessEnv
  await introspectGlobalSetup(env)
  expect(env.RUN_DIR).toBeUndefined()
  expect(existsSync(join(base, 'run1'))).toBe(false)
  rmSync(base, { recursive: true, force: true })
})
