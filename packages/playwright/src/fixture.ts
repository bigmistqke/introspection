import { test as base, expect } from '@playwright/test'
import { attach } from './attach.js'
import type { IntrospectHandle } from '@introspection/types'

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
      const status = (knownStatuses as readonly string[]).includes(testInfo.status ?? '')
        ? testInfo.status as typeof knownStatuses[number]
        : 'failed' as const
      await handle.detach({ status, duration: testInfo.duration, error: testInfo.error?.message })
    }, { auto: true }],
  })
  return { test, expect }
}

export const { test, expect: _expect } = introspectFixture()
export { _expect as expect }
