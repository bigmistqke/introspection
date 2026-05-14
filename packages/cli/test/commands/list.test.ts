import { describe, it, expect } from 'vitest'
import { formatSessionsTable } from '../../src/commands/list.js'
import type { SessionSummary } from '@introspection/read'

const sessions: SessionSummary[] = [
  { id: 'default__tabs-favorites', startedAt: 100, endedAt: 1100, duration: 1000, project: 'browser-mobile', status: 'failed' },
  { id: 'default__player-offline', startedAt: 200, project: 'browser-desktop' },
]

describe('formatSessionsTable', () => {
  it('renders one row per session with id, project, status and duration', () => {
    const out = formatSessionsTable(sessions)
    expect(out).toContain('default__tabs-favorites')
    expect(out).toContain('browser-mobile')
    expect(out).toContain('failed')
    expect(out).toContain('1000ms')
    expect(out).toContain('default__player-offline')
    expect(out).toContain('browser-desktop')
  })

  it('shows running/ongoing markers when status and endedAt are absent', () => {
    const out = formatSessionsTable([{ id: 's', startedAt: 1 }])
    expect(out).toContain('s')
    expect(out).toContain('ongoing')
  })
})
