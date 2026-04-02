import { describe, it, expect, vi } from 'vitest'
import { createPageProxy } from '../src/proxy.js'

describe('createPageProxy', () => {
  it('emits a playwright.action event when a tracked method is called', () => {
    const emitted: unknown[] = []
    const emit = vi.fn((evt) => emitted.push(evt))

    const fakePage = {
      click: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      untracked: vi.fn().mockResolvedValue(undefined),
    }

    const proxy = createPageProxy(fakePage as never, emit)
    proxy.click('#btn', { timeout: 1000 })

    expect(emit).toHaveBeenCalledOnce()
    const evt = emitted[0] as { type: string; data: { method: string; args: unknown[] } }
    expect(evt.type).toBe('playwright.action')
    expect((evt as { source: string }).source).toBe('playwright')
    expect(evt.data.method).toBe('click')
    expect(evt.data.args[0]).toBe('#btn')
    // options object is sanitized (JSON round-trip)
    expect(evt.data.args[1]).toEqual({ timeout: 1000 })
  })

  it('does not emit for untracked methods', () => {
    const emit = vi.fn()
    const fakePage = { untracked: vi.fn() }
    const proxy = createPageProxy(fakePage as never, emit)
    proxy.untracked()
    expect(emit).not.toHaveBeenCalled()
  })

  it('sanitizeArgs: functions become [function], circular objects become [unserializable]', () => {
    const emitted: unknown[] = []
    const emit = vi.fn((evt) => emitted.push(evt))
    const fakePage = { click: vi.fn() }
    const proxy = createPageProxy(fakePage as never, emit)

    const circular: Record<string, unknown> = {}
    circular.self = circular
    proxy.click(() => {}, null, circular)

    const evt = emitted[0] as { data: { args: unknown[] } }
    expect(evt.data.args[0]).toBe('[function]')
    expect(evt.data.args[1]).toBeNull()
    expect(evt.data.args[2]).toBe('[unserializable]')
  })

  it('still calls the original page method', async () => {
    const emit = vi.fn()
    const mockGoto = vi.fn().mockResolvedValue({ url: () => '/home' })
    const fakePage = { goto: mockGoto }
    const proxy = createPageProxy(fakePage as never, emit)
    await proxy.goto('/home')
    expect(mockGoto).toHaveBeenCalledWith('/home')
  })
})
