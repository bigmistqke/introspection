import { describe, it, expect, vi } from 'vitest'
import { createBus } from '../src/bus.js'

describe('bus.emit', () => {
  it('runs all handlers even when one rejects', async () => {
    const bus = createBus()
    const ok: number[] = []
    bus.on('manual', () => { throw new Error('boom') })
    bus.on('manual', async () => { ok.push(1) })
    await bus.emit('manual', { trigger: 'manual', timestamp: 0 })
    expect(ok).toEqual([1])
  })

  it('reports rejections on stderr with [bus] prefix', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bus = createBus()
    bus.on('manual', () => { throw new Error('boom') })
    await bus.emit('manual', { trigger: 'manual', timestamp: 0 })
    expect(err).toHaveBeenCalled()
    const call = err.mock.calls[0]!
    expect(String(call[0])).toContain('[bus]')
    err.mockRestore()
  })

  it('re-emits app-channel rejections on introspect:warning', async () => {
    const bus = createBus()
    const warnings: Array<{ name: string; message: string }> = []
    bus.on('introspect:warning', ({ error }) => {
      warnings.push({ name: error.name, message: error.message })
    })
    bus.on('mark', () => { throw new Error('from-mark-handler') })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await bus.emit('mark', { id: 'x', timestamp: 0, type: 'mark', metadata: { label: 'l' } } as never)
    expect(warnings.length).toBe(1)
    expect(warnings[0]!.message).toContain('from-mark-handler')
    errSpy.mockRestore()
  })

  it('does not recurse: introspect:warning handler rejections hit stderr only', async () => {
    const bus = createBus()
    let reEmitCount = 0
    bus.on('introspect:warning', () => { reEmitCount++; throw new Error('from-warning-handler') })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await bus.emit('introspect:warning', { error: { name: 'X', message: 'y', source: 'cdp' } })
    expect(reEmitCount).toBe(1)
    err.mockRestore()
  })
})
