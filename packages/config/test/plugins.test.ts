import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { loadPlugins } from '../src/plugins.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('loadPlugins', () => {
  const presetsCwd = resolve(__dirname, 'fixtures/config-presets')

  it('returns default preset when env var not set', async () => {
    const plugins = await loadPlugins({ cwd: presetsCwd, env: {} })
    expect(plugins.map(p => p.name)).toEqual(['fixture-default-plugin'])
  })

  it('returns named preset when INTROSPECT_PRESET is set', async () => {
    const plugins = await loadPlugins({
      cwd: presetsCwd,
      env: { INTROSPECT_PRESET: 'network' },
    })
    expect(plugins.map(p => p.name)).toEqual(['fixture-network-plugin'])
  })

  it('returns optsPlugins verbatim when provided, skipping config', async () => {
    const fake = [{ name: 'explicit', install: async () => {} }] as any
    const plugins = await loadPlugins({
      cwd: presetsCwd,
      env: { INTROSPECT_PRESET: 'network' },
      optsPlugins: fake,
    })
    expect(plugins).toBe(fake)
  })

  it('returns [] when no config is discovered and no opts', async () => {
    const plugins = await loadPlugins({ cwd: '/tmp', env: {} })
    expect(plugins).toEqual([])
  })

  it('defaults env to process.env when not provided', async () => {
    const prev = process.env.INTROSPECT_PRESET
    process.env.INTROSPECT_PRESET = 'network'
    try {
      const plugins = await loadPlugins({ cwd: presetsCwd })
      expect(plugins.map(p => p.name)).toEqual(['fixture-network-plugin'])
    } finally {
      if (prev === undefined) delete process.env.INTROSPECT_PRESET
      else process.env.INTROSPECT_PRESET = prev
    }
  })
})
