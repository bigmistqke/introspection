import { rm } from 'fs/promises'
import { join } from 'path'
import { readRunMeta, writeRunMeta, scanSessionMetas, computeAggregateStatus } from './run-meta.js'
import { getIntrospectConfig } from './config-store.js'

const RETAINED: ReadonlySet<string> = new Set(['failed', 'timedOut', 'interrupted', 'crashed'])

/**
 * Runner-side run lifecycle teardown. Default-exported so Playwright can load
 * it as a globalTeardown module. Scans per-test session metas to compute the
 * run's aggregate status, then applies `retain-on-failure` cleanup in the same
 * pass.
 */
export default async function introspectGlobalTeardown(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (env.INTROSPECT_TRACING === '0') return
  const runDir = env.RUN_DIR
  if (!runDir) return

  const sessions = await scanSessionMetas(runDir)
  const status = computeAggregateStatus(sessions.map((s) => s.status))

  const meta = await readRunMeta(runDir)
  await writeRunMeta(runDir, { ...meta, endedAt: Date.now(), status })

  const mode = getIntrospectConfig()?.mode ?? 'on'
  if (mode === 'retain-on-failure') {
    for (const session of sessions) {
      if (!session.status || !RETAINED.has(session.status)) {
        await rm(join(runDir, session.dir), { recursive: true, force: true })
      }
    }
  }
}
