import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { attachRun } from '../src/attach-run.js'

let dir: string
test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-attachrun-'))
})
test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

test('attachRun creates a run dir with RunMeta and attaches a session into it', async ({ page }) => {
  const handle = await attachRun(page, { dir, plugins: [] })
  await handle.detach()

  // run id is surfaced on the handle
  expect(handle.runId).toBeTruthy()

  // <dir>/<run-id>/meta.json is a RunMeta
  const runMeta = JSON.parse(await readFile(join(dir, handle.runId, 'meta.json'), 'utf-8'))
  expect(runMeta).toMatchObject({ version: '1', id: handle.runId })
  expect(typeof runMeta.startedAt).toBe('number')

  // exactly one session directory under the run, with a SessionMeta
  const sessionDirs = (await readdir(join(dir, handle.runId))).filter(entry => entry !== 'meta.json')
  expect(sessionDirs.length).toBe(1)
  const sessionMeta = await readFile(join(dir, handle.runId, sessionDirs[0], 'meta.json'), 'utf-8')
  expect(sessionMeta).toContain('"version": "2"')
})
