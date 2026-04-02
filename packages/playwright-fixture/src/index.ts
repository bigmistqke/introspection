import { test as base, expect } from '@playwright/test'
import { attach } from '@introspection/playwright'
import type { IntrospectHandle, TestResult } from '@introspection/types'

export interface IntrospectFixtureOptions {
  viteUrl?: string
  outDir?: string
}

export function introspectFixture(opts: IntrospectFixtureOptions = {}) {
  const test = base.extend<{ introspect: IntrospectHandle }>({
    introspect: [async ({ page }, use, testInfo) => {
      const handle = await attach(page, {
        testTitle: testInfo.title,
        testFile: testInfo.file,
        workerIndex: testInfo.workerIndex,
        ...(opts.viteUrl ? { viteUrl: opts.viteUrl } : {}),
        ...(opts.outDir ? { outDir: opts.outDir } : {}),
      })
      await use(handle)
      const knownStatuses = ['passed', 'failed', 'timedOut', 'skipped'] as const
      type KnownStatus = typeof knownStatuses[number]
      const status: TestResult['status'] = (knownStatuses as readonly string[]).includes(testInfo.status)
        ? testInfo.status as KnownStatus
        : 'failed'
      const result: TestResult = {
        status,
        duration: testInfo.duration,
        error: testInfo.error?.message,
      }
      await handle.detach(result)
    }, { auto: true }],
  })

  return { test, expect }
}

// Default export for drop-in replacement: import { test, expect } from '@introspection/playwright-fixture'
export const { test, expect: _expect } = introspectFixture()
export { _expect as expect }
