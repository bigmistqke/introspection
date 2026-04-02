import { describe, it, expect } from 'vitest'
import { queryBody } from '../../src/commands/body.js'

const rawBody = JSON.stringify({ users: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }], total: 2 })

describe('queryBody', () => {
  it('pretty-prints the full body when no options', () => {
    const out = queryBody(rawBody, {})
    expect(out).toContain('Alice')
    expect(out).toContain('total')
  })

  it('--path extracts a nested value', () => {
    const out = queryBody(rawBody, { path: '$.users[0].name' })
    expect(out).toContain('Alice')
    expect(out).not.toContain('Bob')
  })

  it('returns error message for invalid path', () => {
    const out = queryBody(rawBody, { path: '$.nonexistent' })
    expect(out).toContain('no match')
  })
})
