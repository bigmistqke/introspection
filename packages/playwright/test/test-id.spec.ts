import { test, expect } from '@playwright/test'
import type { TestInfo } from '@playwright/test'
import { testIdFor } from '../src/test-id.js'

function fakeInfo(partial: { project: { name: string }; titlePath?: string[]; retry?: number }): TestInfo {
  return { titlePath: ['file.spec.ts', 'desc', 'name'], retry: 0, ...partial } as unknown as TestInfo
}

test('builds <project>__<slug> from project name and titlePath', () => {
  expect(testIdFor(fakeInfo({ project: { name: 'browser-mobile' } })))
    .toBe('browser-mobile__file-spec-ts-desc-name')
})

test('falls back to "default" when the project name is empty', () => {
  expect(testIdFor(fakeInfo({ project: { name: '' } })))
    .toBe('default__file-spec-ts-desc-name')
})

test('appends a retry suffix when retry > 0', () => {
  expect(testIdFor(fakeInfo({ project: { name: 'p' }, retry: 2 })))
    .toBe('p__file-spec-ts-desc-name-2')
})
