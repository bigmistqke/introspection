import { mkdir } from 'fs/promises'
import { join } from 'path'
import { resolveRunId } from './run-id.js'
import { detectGitInfo, writeRunMeta } from './run-meta.js'

/**
 * Runner-side run lifecycle setup. Default-exported so Playwright can load it
 * as a globalSetup module. The `env` parameter defaults to `process.env`;
 * passing it explicitly is for tests. Mutates `env.RUN_DIR` so test workers
 * (which inherit the runner's environment) can find the run directory.
 */
export default async function introspectGlobalSetup(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
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
