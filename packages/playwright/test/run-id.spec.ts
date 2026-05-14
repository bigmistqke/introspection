import { test, expect } from '@playwright/test'
import { resolveRunId } from '../src/run-id.js'

test('uses INTROSPECT_RUN_ID when set', () => {
  expect(resolveRunId({ INTROSPECT_RUN_ID: 'main_4821' })).toBe('main_4821')
})

test('auto-generates a timestamped id with a random suffix when env is unset', () => {
  const id = resolveRunId({})
  expect(id).toMatch(/^\d{8}-\d{6}-[0-9a-f]{4}$/)
})

test('two auto-generated ids are distinct', () => {
  expect(resolveRunId({})).not.toBe(resolveRunId({}))
})
