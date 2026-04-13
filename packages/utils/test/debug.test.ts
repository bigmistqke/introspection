import { describe, it, expect, vi } from 'vitest'
import { createDebug } from '../src/debug.js'

describe('createDebug', () => {
  it('writes to stderr when verbose is true', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const debug = createDebug('test', true)
    debug('hello', 1, 2)
    expect(log).toHaveBeenCalledWith('[test]', 'hello', 1, 2)
    log.mockRestore()
  })

  it('does not write to stderr when verbose is false', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const debug = createDebug('test', false)
    debug('hello')
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('notifies subscribers regardless of verbose flag', () => {
    const debug = createDebug('label', false)
    const received: Array<{ message: string; args: unknown[] }> = []
    debug.subscribe((message, args) => received.push({ message, args }))
    debug('msg', 'a', 'b')
    expect(received).toEqual([{ message: 'msg', args: ['a', 'b'] }])
  })

  it('returns an unsubscribe function', () => {
    const debug = createDebug('label', false)
    const received: string[] = []
    const unsubscribe = debug.subscribe((message) => received.push(message))
    debug('first')
    unsubscribe()
    debug('second')
    expect(received).toEqual(['first'])
  })

  it('supports multiple subscribers', () => {
    const debug = createDebug('label', false)
    const a: string[] = []
    const b: string[] = []
    debug.subscribe((message) => a.push(message))
    debug.subscribe((message) => b.push(message))
    debug('hi')
    expect(a).toEqual(['hi'])
    expect(b).toEqual(['hi'])
  })
})
