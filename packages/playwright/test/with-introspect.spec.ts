import { test, expect } from '@playwright/test'
import { withIntrospect } from '../src/with-introspect.js'
import { getIntrospectConfig } from '../src/config-store.js'

test('stashes config and composes globalSetup/globalTeardown as arrays', () => {
  const result = withIntrospect(
    { testDir: './tests', globalSetup: './my-setup.ts', globalTeardown: './my-teardown.ts' },
    { plugins: [], mode: 'retain-on-failure' },
  )

  // singleton populated
  expect(getIntrospectConfig()).toEqual({ plugins: [], reporters: [], mode: 'retain-on-failure' })

  // introspection sets up first, tears down last; project's own preserved
  expect(Array.isArray(result.globalSetup)).toBe(true)
  expect((result.globalSetup as string[])[0]).toMatch(/global-setup\.(js|ts)$/)
  expect((result.globalSetup as string[])[1]).toBe('./my-setup.ts')
  expect((result.globalTeardown as string[]).at(-1)).toMatch(/global-teardown\.(js|ts)$/)
  expect((result.globalTeardown as string[])[0]).toBe('./my-teardown.ts')

  // untouched field passes through
  expect(result.testDir).toBe('./tests')
})

test('handles a config with no existing globalSetup/globalTeardown', () => {
  const result = withIntrospect({ testDir: './t' }, { plugins: [] })
  expect((result.globalSetup as string[]).length).toBe(1)
  expect((result.globalTeardown as string[]).length).toBe(1)
  expect(getIntrospectConfig()?.mode).toBe('on')
})
