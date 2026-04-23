import { describe, it, expect } from 'vitest'
import { resolvePlugins } from '../src/resolve.js'
import type { IntrospectionPlugin } from '@introspection/types'

function fakePlugin(name: string): IntrospectionPlugin {
  return { name, install: async () => {} } as IntrospectionPlugin
}

describe('resolvePlugins', () => {
  it('returns [] when config is undefined and no env var', () => {
    expect(resolvePlugins({ config: undefined, env: {} })).toEqual([])
  })

  it('returns opts.plugins when provided, ignoring config and env', () => {
    const p = [fakePlugin('a')]
    const result = resolvePlugins({
      optsPlugins: p,
      config: { plugins: [fakePlugin('b')] },
      env: { INTROSPECT_PRESET: 'whatever' },
    })
    expect(result).toBe(p)
  })

  it('array-form config returns the array when env var not set', () => {
    const p = [fakePlugin('a')]
    expect(resolvePlugins({ config: { plugins: p }, env: {} })).toEqual(p)
  })

  it('array-form config with INTROSPECT_PRESET set throws', () => {
    expect(() =>
      resolvePlugins({
        config: { plugins: [fakePlugin('a')] },
        env: { INTROSPECT_PRESET: 'network' },
      })
    ).toThrow(/array form.*presets are not defined/i)
  })

  it('object-form config returns default preset when env var not set', () => {
    const dflt = [fakePlugin('d')]
    expect(
      resolvePlugins({
        config: { plugins: { default: dflt, network: [fakePlugin('n')] } },
        env: {},
      })
    ).toEqual(dflt)
  })

  it('object-form config returns named preset when env var set', () => {
    const net = [fakePlugin('n')]
    expect(
      resolvePlugins({
        config: { plugins: { default: [], network: net } },
        env: { INTROSPECT_PRESET: 'network' },
      })
    ).toEqual(net)
  })

  it('comma-separated env var merges presets in order', () => {
    const net = [fakePlugin('n')]
    const state = [fakePlugin('s')]
    expect(
      resolvePlugins({
        config: { plugins: { default: [], network: net, state } },
        env: { INTROSPECT_PRESET: 'network,state' },
      })
    ).toEqual([...net, ...state])
  })

  it('unknown preset name throws with a helpful message', () => {
    expect(() =>
      resolvePlugins({
        config: { plugins: { default: [], network: [] } },
        env: { INTROSPECT_PRESET: 'netwrk' },
      })
    ).toThrow(/unknown preset.*netwrk.*available.*default.*network/i)
  })

  it('env var with one unknown name in a list throws', () => {
    expect(() =>
      resolvePlugins({
        config: { plugins: { default: [], network: [] } },
        env: { INTROSPECT_PRESET: 'network,bogus' },
      })
    ).toThrow(/unknown preset.*bogus/i)
  })

  it('empty string env var is treated as unset', () => {
    const dflt = [fakePlugin('d')]
    expect(
      resolvePlugins({
        config: { plugins: { default: dflt } },
        env: { INTROSPECT_PRESET: '' },
      })
    ).toEqual(dflt)
  })

  it('INTROSPECT_PRESET set with no config throws', () => {
    expect(() =>
      resolvePlugins({
        config: undefined,
        env: { INTROSPECT_PRESET: 'network' },
      })
    ).toThrow(/INTROSPECT_PRESET.*no introspect config was found/i)
  })
})
