import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { loadIntrospectConfig } from '../src/load.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('loadIntrospectConfig', () => {
  it('returns undefined when no config is found above cwd', async () => {
    const result = await loadIntrospectConfig({ cwd: '/tmp' })
    expect(result).toBeUndefined()
  })

  it('loads array-form config from same directory', async () => {
    const cwd = resolve(__dirname, 'fixtures/config-array')
    const config = await loadIntrospectConfig({ cwd })
    expect(config).toBeDefined()
    expect(Array.isArray(config!.plugins)).toBe(true)
  })

  it('loads preset-form config from a nested subdirectory (walks up)', async () => {
    const cwd = resolve(__dirname, 'fixtures/config-presets/nested/dir')
    const config = await loadIntrospectConfig({ cwd })
    expect(config).toBeDefined()
    expect(Array.isArray(config!.plugins)).toBe(false)
    const presets = config!.plugins as Record<string, unknown>
    expect(Object.keys(presets).sort()).toEqual(['default', 'network'])
  })

  it('respects explicit configPath, skipping discovery', async () => {
    const explicit = resolve(__dirname, 'fixtures/config-presets/introspect.config.ts')
    const config = await loadIntrospectConfig({ cwd: '/tmp', configPath: explicit })
    expect(config).toBeDefined()
    expect(Array.isArray(config!.plugins)).toBe(false)
  })

  it('throws when explicit configPath does not exist', async () => {
    await expect(
      loadIntrospectConfig({ cwd: '/tmp', configPath: '/no/such/file.ts' })
    ).rejects.toThrow(/no such file|ENOENT|not found/i)
  })

  it('defaults cwd to process.cwd() when not provided', async () => {
    const prev = process.cwd()
    const fixtureCwd = resolve(__dirname, 'fixtures/config-array')
    try {
      process.chdir(fixtureCwd)
      const config = await loadIntrospectConfig()
      expect(config).toBeDefined()
      expect(Array.isArray(config!.plugins)).toBe(true)
    } finally {
      process.chdir(prev)
    }
  })
})
