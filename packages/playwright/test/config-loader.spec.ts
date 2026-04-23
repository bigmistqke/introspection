import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { loadIntrospectConfig } from '../src/config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('returns undefined when no config is found above cwd', async () => {
  const result = await loadIntrospectConfig({ cwd: '/tmp' })
  expect(result).toBeUndefined()
})

test('loads array-form config from same directory', async () => {
  const cwd = resolve(__dirname, 'fixtures/config-array')
  const config = await loadIntrospectConfig({ cwd })
  expect(config).toBeDefined()
  expect(Array.isArray(config!.plugins)).toBe(true)
})

test('loads preset-form config from a nested subdirectory (walks up)', async () => {
  const cwd = resolve(__dirname, 'fixtures/config-presets/nested/dir')
  const config = await loadIntrospectConfig({ cwd })
  expect(config).toBeDefined()
  expect(Array.isArray(config!.plugins)).toBe(false)
  const presets = config!.plugins as Record<string, unknown>
  expect(Object.keys(presets).sort()).toEqual(['default', 'network'])
})

test('respects explicit configPath, skipping discovery', async () => {
  const explicit = resolve(__dirname, 'fixtures/config-presets/introspect.config.ts')
  const config = await loadIntrospectConfig({ cwd: '/tmp', configPath: explicit })
  expect(config).toBeDefined()
  expect(Array.isArray(config!.plugins)).toBe(false)
})

test('throws when explicit configPath does not exist', async () => {
  await expect(
    loadIntrospectConfig({ cwd: '/tmp', configPath: '/no/such/file.ts' })
  ).rejects.toThrow(/no such file|ENOENT|not found/i)
})
