import { test, expect } from '@playwright/test'
import { setIntrospectConfig, getIntrospectConfig } from '../src/config-store.js'

test('config store round-trips the stored config', () => {
  expect(getIntrospectConfig()).toBeUndefined()
  setIntrospectConfig({ plugins: [], reporters: [], mode: 'retain-on-failure' })
  expect(getIntrospectConfig()).toEqual({ plugins: [], reporters: [], mode: 'retain-on-failure' })
})
