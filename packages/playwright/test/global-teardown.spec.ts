import { test, expect } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { runGlobalTeardown } from '../src/global-teardown.js'
import { setIntrospectConfig } from '../src/config-store.js'

function seedRun(): { base: string; runDir: string } {
  const base = mkdtempSync(join(tmpdir(), 'introspect-teardown-'))
  const runDir = join(base, 'run1')
  mkdirSync(runDir)
  writeFileSync(join(runDir, 'meta.json'), JSON.stringify({ version: '1', id: 'run1', startedAt: 1 }))
  for (const [name, status] of [['a', 'passed'], ['b', 'failed']] as const) {
    mkdirSync(join(runDir, name))
    writeFileSync(join(runDir, name, 'meta.json'), JSON.stringify({ version: '2', id: name, startedAt: 0, status }))
  }
  return { base, runDir }
}

test('writes endedAt + aggregate status, keeps all dirs in mode "on"', async () => {
  const { base, runDir } = seedRun()
  setIntrospectConfig({ plugins: [], reporters: [], mode: 'on' })
  await runGlobalTeardown({ RUN_DIR: runDir } as NodeJS.ProcessEnv)

  const meta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf-8'))
  expect(meta.status).toBe('failed')
  expect(meta.endedAt).toBeDefined()
  expect(existsSync(join(runDir, 'a'))).toBe(true)
  expect(existsSync(join(runDir, 'b'))).toBe(true)
  rmSync(base, { recursive: true, force: true })
})

test('retain-on-failure deletes passing session dirs', async () => {
  const { base, runDir } = seedRun()
  setIntrospectConfig({ plugins: [], reporters: [], mode: 'retain-on-failure' })
  await runGlobalTeardown({ RUN_DIR: runDir } as NodeJS.ProcessEnv)

  expect(existsSync(join(runDir, 'a'))).toBe(false)  // passed → deleted
  expect(existsSync(join(runDir, 'b'))).toBe(true)   // failed → kept
  rmSync(base, { recursive: true, force: true })
})

test('does nothing when RUN_DIR is unset', async () => {
  await runGlobalTeardown({} as NodeJS.ProcessEnv)  // must not throw
})
