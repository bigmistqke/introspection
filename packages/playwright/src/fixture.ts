import { test as base, expect } from '@playwright/test'
import type { IntrospectionPlugin } from '@introspection/types'
import { attach } from './attach.js'
import type { IntrospectHandle } from '@introspection/types'

export interface IntrospectFixtureOptions {
  plugins: IntrospectionPlugin[]   // required
  viteUrl?: string
  outDir?: string
}

export function introspectFixture(opts: IntrospectFixtureOptions) {
  const test = base.extend<{ introspect: IntrospectHandle }>({
    introspect: [async ({ page }, use, testInfo) => {
      const handle = await attach(page, {
        testTitle: testInfo.title,
        workerIndex: testInfo.workerIndex,
        plugins: opts.plugins,
        ...(opts.outDir ? { outDir: opts.outDir } : {}),
      })
      await use(handle)
      const knownStatuses = ['passed', 'failed', 'timedOut', 'skipped'] as const
      const status = (knownStatuses as readonly string[]).includes(testInfo.status ?? '')
        ? testInfo.status as typeof knownStatuses[number]
        : 'failed' as const
      if (status !== 'passed' && status !== 'skipped') await handle.snapshot()
      await handle.detach({ status, duration: testInfo.duration, error: testInfo.error?.message })
    }, { auto: true }],
  })
  return { test, expect }
}
