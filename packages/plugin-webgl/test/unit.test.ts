import { describe, it, expect, vi } from 'vitest'
import type { PluginContext } from '@introspection/types'

describe('webgl() — Node-side', () => {
  it('has name "webgl" and a non-empty script', async () => {
    const { webgl } = await import('../src/index.js')
    const plugin = webgl()
    expect(plugin.name).toBe('webgl')
    expect(plugin.script.length).toBeGreaterThan(0)
  })

  it('watch() serialises RegExp name filter as { source, flags }', async () => {
    const { webgl } = await import('../src/index.js')
    const plugin = webgl()
    const addSubscription = vi.fn().mockResolvedValue({ unwatch: vi.fn() })
    await plugin.install({ addSubscription, page: { evaluate: vi.fn() }, cdpSession: { send: vi.fn() }, emit: vi.fn(), writeAsset: vi.fn(), timestamp: () => 0 } as unknown as PluginContext)
    await plugin.watch({ event: 'uniform', name: /^u_/ })
    expect(addSubscription).toHaveBeenCalledWith('webgl', expect.objectContaining({
      name: { source: '^u_', flags: '' },
    }))
  })
})
