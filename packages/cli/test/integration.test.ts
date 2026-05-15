import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cliEntry = join(packageRoot, 'dist', 'index.js')

function runCli(args: string[]): string {
  return execFileSync('node', [cliEntry, ...args], { encoding: 'utf-8' })
}

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-cli-int-'))

  // run-old (older), run-new (newer); run-new has two traces
  await mkdir(join(dir, 'run-old', 'sess-o'), { recursive: true })
  await writeFile(join(dir, 'run-old', 'meta.json'), JSON.stringify({ version: '1', id: 'run-old', startedAt: 100, endedAt: 200, status: 'passed', branch: 'main' }))
  await writeFile(join(dir, 'run-old', 'sess-o', 'meta.json'), JSON.stringify({ version: '2', id: 'sess-o', startedAt: 110, endedAt: 190, status: 'passed', project: 'p' }))
  await writeFile(join(dir, 'run-old', 'sess-o', 'events.ndjson'), '')

  await mkdir(join(dir, 'run-new', 'sess-early'), { recursive: true })
  await mkdir(join(dir, 'run-new', 'sess-late'), { recursive: true })
  await writeFile(join(dir, 'run-new', 'meta.json'), JSON.stringify({ version: '1', id: 'run-new', startedAt: 500, status: 'failed', branch: 'feat' }))
  await writeFile(join(dir, 'run-new', 'sess-early', 'meta.json'), JSON.stringify({ version: '2', id: 'sess-early', startedAt: 510, project: 'p' }))
  await writeFile(join(dir, 'run-new', 'sess-early', 'events.ndjson'), '')
  await writeFile(join(dir, 'run-new', 'sess-late', 'meta.json'), JSON.stringify({ version: '2', id: 'sess-late', startedAt: 590, label: 'the late one', project: 'p' }))
  await writeFile(join(dir, 'run-new', 'sess-late', 'events.ndjson'), '')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('introspect CLI — hierarchy navigation', () => {
  it('runs lists all runs, newest first', () => {
    const out = runCli(['runs', '--dir', dir])
    const firstLine = out.trim().split('\n')[0]
    expect(firstLine).toContain('run-new')
    expect(out).toContain('run-old')
  })

  it('list defaults to the latest run', () => {
    const out = runCli(['list', '--dir', dir])
    expect(out).toContain('sess-early')
    expect(out).toContain('sess-late')
    expect(out).not.toContain('sess-o')
  })

  it('list --run scopes to the named run', () => {
    const out = runCli(['list', '--dir', dir, '--run', 'run-old'])
    expect(out).toContain('sess-o')
    expect(out).not.toContain('sess-early')
  })

  it('summary with no flags resolves the latest trace of the latest run', () => {
    // sess-late is the newest trace of the newest run; buildSummary shows its label
    const out = runCli(['summary', '--dir', dir])
    expect(out).toContain('the late one')
  })

  it('summary --run --trace-id targets a specific trace', () => {
    const out = runCli(['summary', '--dir', dir, '--run', 'run-old', '--trace-id', 'sess-o'])
    expect(out).toContain('sess-o')
  })
})
