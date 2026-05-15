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

test('attachRun creates a run dir with RunMeta and attaches a trace into it', async ({ page }) => {
  const handle = await attachRun(page, { dir, plugins: [] })
  await handle.detach()

  // run id is surfaced on the handle
  expect(handle.runId).toBeTruthy()

  // <dir>/<run-id>/meta.json is a RunMeta
  const runMeta = JSON.parse(await readFile(join(dir, handle.runId, 'meta.json'), 'utf-8'))
  expect(runMeta).toMatchObject({ version: '1', id: handle.runId })
  expect(typeof runMeta.startedAt).toBe('number')

  // exactly one trace directory under the run, with a TraceMeta
  const traceDirs = (await readdir(join(dir, handle.runId))).filter(entry => entry !== 'meta.json')
  expect(traceDirs.length).toBe(1)
  const traceMeta = await readFile(join(dir, handle.runId, traceDirs[0], 'meta.json'), 'utf-8')
  expect(traceMeta).toContain('"version": "2"')
})
