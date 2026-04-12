import { describe, it, expect } from 'vitest'
import { matchEventType } from '../src/index.js'

describe('matchEventType', () => {
  it('exact match returns true only for identical type', () => {
    expect(matchEventType('mark', 'mark')).toBe(true)
    expect(matchEventType('mark', 'mark.other')).toBe(false)
    expect(matchEventType('mark', 'network.request')).toBe(false)
  })

  it('.* suffix matches the bare prefix', () => {
    expect(matchEventType('network.*', 'network')).toBe(true)
  })

  it('.* suffix matches children at the prefix boundary', () => {
    expect(matchEventType('network.*', 'network.request')).toBe(true)
    expect(matchEventType('network.*', 'network.response')).toBe(true)
    expect(matchEventType('network.*', 'network.response.body')).toBe(true)
  })

  it('.* suffix does not match types that merely start with the prefix but not at a boundary', () => {
    expect(matchEventType('net.*', 'network.request')).toBe(false)
  })

  it('.* suffix does not match an unrelated namespace', () => {
    expect(matchEventType('network.*', 'perf.cwv')).toBe(false)
  })
})
