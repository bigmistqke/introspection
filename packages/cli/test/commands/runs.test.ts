import { describe, it, expect } from 'vitest'
import { formatRunsTable } from '../../src/commands/runs.js'
import type { RunSummary } from '@introspection/read'

const runs: RunSummary[] = [
  { id: 'main_4821', startedAt: 1_700_000_000_000, endedAt: 1_700_000_060_000, status: 'failed', branch: 'main', traceCount: 12 },
  { id: '20260514-101500-ab12', startedAt: 1_699_900_000_000, status: 'passed', branch: 'feat-x', traceCount: 3 },
]

describe('formatRunsTable', () => {
  it('renders one row per run with id, status, branch and trace count', () => {
    const out = formatRunsTable(runs)
    expect(out).toContain('main_4821')
    expect(out).toContain('failed')
    expect(out).toContain('main')
    expect(out).toContain('12')
    expect(out).toContain('20260514-101500-ab12')
    expect(out).toContain('passed')
    expect(out).toContain('feat-x')
  })

  it('handles a run with no status or branch', () => {
    const out = formatRunsTable([{ id: 'r', startedAt: 1, traceCount: 0 }])
    expect(out).toContain('r')
    expect(out).toContain('0')
  })
})
