import { mkdir } from 'fs/promises'
import { join } from 'path'
import { resolveRunId } from './run-id.js'
import { detectGitInfo, writeRunMeta } from './run-meta.js'

/**
 * The run lifecycle setup logic, parameterised on the environment for
 * testability. Mutates `env.RUN_DIR` so test workers (which inherit the
 * runner's environment at spawn time) can find the run directory.
 */
export async function runGlobalSetup(env: NodeJS.ProcessEnv): Promise<void> {
  if (env.INTROSPECT_TRACING === '0') return

  const runId = resolveRunId(env)
  const baseDir = env.INTROSPECT_DIR ?? '.introspect'
  const runDir = join(baseDir, runId)
  await mkdir(runDir, { recursive: true })

  await writeRunMeta(runDir, {
    version: '1',
    id: runId,
    startedAt: Date.now(),
    ...detectGitInfo(env),
  })

  env.RUN_DIR = runDir
}

/**
 * Default export for Playwright's `globalSetup`. Playwright invokes this with
 * the resolved config as its argument — which is why the real work lives in
 * `runGlobalSetup(env)` and this wrapper hard-wires `process.env`.
 */
export default function introspectGlobalSetup(): Promise<void> {
  return runGlobalSetup(process.env)
}
