import { execFileSync } from 'child_process'
import { readFile, writeFile, readdir } from 'fs/promises'
import { join } from 'path'
import type { RunMeta, RunStatus, SessionMeta, SessionStatus } from '@introspection/types'

const FAILING: ReadonlySet<string> = new Set(['failed', 'timedOut', 'interrupted', 'crashed'])

function gitOutput(args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

/** Best-effort branch + commit: env overrides win, else local git, else absent. */
export function detectGitInfo(env: NodeJS.ProcessEnv = process.env): { branch?: string; commit?: string } {
  const branch = env.INTROSPECT_RUN_BRANCH || gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'])
  const commit = env.INTROSPECT_RUN_COMMIT || gitOutput(['rev-parse', 'HEAD'])
  const info: { branch?: string; commit?: string } = {}
  if (branch) info.branch = branch
  if (commit) info.commit = commit
  return info
}

export async function writeRunMeta(runDir: string, meta: RunMeta): Promise<void> {
  await writeFile(join(runDir, 'meta.json'), JSON.stringify(meta, null, 2))
}

export async function readRunMeta(runDir: string): Promise<RunMeta> {
  return JSON.parse(await readFile(join(runDir, 'meta.json'), 'utf-8')) as RunMeta
}

export interface ScannedSession {
  dir: string
  status: SessionStatus | undefined
}

/** Reads `status` from every `<runDir>/<dir>/meta.json`, skipping the run's own meta.json. */
export async function scanSessionMetas(runDir: string): Promise<ScannedSession[]> {
  const entries = await readdir(runDir, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  return Promise.all(
    dirs.map(async (dir): Promise<ScannedSession> => {
      try {
        const meta = JSON.parse(await readFile(join(runDir, dir, 'meta.json'), 'utf-8')) as SessionMeta
        return { dir, status: meta.status }
      } catch {
        return { dir, status: undefined }
      }
    }),
  )
}

export function computeAggregateStatus(statuses: ReadonlyArray<string | undefined>): RunStatus {
  return statuses.some((s) => s !== undefined && FAILING.has(s)) ? 'failed' : 'passed'
}
