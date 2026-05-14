import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Page } from '@playwright/test'
import type { IntrospectHandle, RunMeta } from '@introspection/types'
import { attach, type AttachOptions } from './attach.js'
import { resolveRunId } from './run-id.js'

export interface AttachRunOptions extends Omit<AttachOptions, 'outDir'> {
  /** Base directory for runs. Default: `.introspect`. */
  dir?: string
}

/**
 * Ad-hoc capture convenience: creates a run directory (`<dir>/<run-id>/` with a
 * `RunMeta`) and attaches a single session into it, yielding the
 * `<dir>/<run-id>/<session-id>/` layout the run model expects.
 *
 * `attach` itself stays the per-session primitive — a run can hold many
 * sessions, and in the `withIntrospect` flow the run directory is created once
 * by `globalSetup`. `attachRun` is for the one-run-one-session ad-hoc case
 * (`introspect debug`, demos, scripts).
 *
 * The returned handle is the regular `IntrospectHandle` with the chosen
 * `runId` attached.
 */
export async function attachRun(
  page: Page,
  options: AttachRunOptions = {},
): Promise<IntrospectHandle & { runId: string }> {
  const { dir = '.introspect', ...attachOptions } = options
  const runId = resolveRunId(process.env)
  const runDir = join(dir, runId)
  await mkdir(runDir, { recursive: true })
  const runMeta: RunMeta = { version: '1', id: runId, startedAt: Date.now() }
  await writeFile(join(runDir, 'meta.json'), JSON.stringify(runMeta, null, 2))
  const handle = await attach(page, { ...attachOptions, outDir: runDir })
  return Object.assign(handle, { runId })
}
