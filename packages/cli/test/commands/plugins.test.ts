import { describe, it, expect } from 'vitest'
import { formatPlugins } from '../../src/commands/plugins.js'
import type { SessionMeta } from '@introspection/types'

describe('formatPlugins', () => {
  it('formats plugin metadata with events and options', () => {
    const session: SessionMeta = {
      version: '2',
      id: 'sess-1',
      startedAt: 1000,
      label: 'my test',
      plugins: [
        {
          name: 'js-errors',
          description: 'Captures errors',
          events: { 'js.error': 'Uncaught exception', 'js.error.paused': 'Debugger paused' },
          options: { pauseOnExceptions: { description: 'Pause mode', value: 'uncaught' } },
        },
        {
          name: 'network',
          description: 'Captures HTTP',
          events: { 'network.request': 'Outgoing request' },
        },
      ],
    }
    const out = formatPlugins(session)
    expect(out).toContain('js-errors')
    expect(out).toContain('Captures errors')
    expect(out).toContain('js.error')
    expect(out).toContain('Uncaught exception')
    expect(out).toContain('js.error.paused')
    expect(out).toContain('pauseOnExceptions')
    expect(out).toContain('"uncaught"')
    expect(out).toContain('Pause mode')
    expect(out).toContain('network')
    expect(out).toContain('Captures HTTP')
  })

  it('returns message when no plugins metadata', () => {
    const session: SessionMeta = { version: '2', id: 'sess-1', startedAt: 1000 }
    const out = formatPlugins(session)
    expect(out).toContain('No plugin metadata')
  })
})
