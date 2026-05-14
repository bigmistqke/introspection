import { test as base, expect } from '@playwright/test'
import type { IntrospectHandle } from '@introspection/types'
import { createSessionWriter } from '@introspection/write'
import { attach, toPluginMetas } from './attach.js'
import { getIntrospectConfig } from './config-store.js'
import { installStepCapture } from './step-capture.js'
import { testIdFor } from './test-id.js'

/**
 * The pre-built introspection `test`. The `introspect` auto-fixture captures
 * every test into `<RUN_DIR>/<test-id>/`, wiring plugins/reporters from the
 * module config singleton (populated by withIntrospect). It is `undefined`
 * when tracing is disabled, when there is no run context, or on the first
 * attempt under `on-first-retry`.
 */
export const test = base.extend<{ introspect: IntrospectHandle | undefined }>({
  introspect: [
    async ({ page }, use, testInfo) => {
      const config = getIntrospectConfig()
      const runDir = process.env.RUN_DIR

      // No run context, tracing off, or first-attempt under on-first-retry:
      // no-op handle, capture nothing.
      const skip =
        process.env.INTROSPECT_TRACING === '0' ||
        !config ||
        !runDir ||
        (config.mode === 'on-first-retry' && testInfo.retry === 0)
      if (skip) {
        await use(undefined)
        return
      }

      const project = testInfo.project.name || 'default'
      const session = await createSessionWriter({
        outDir: runDir,
        id: testIdFor(testInfo),
        label: testInfo.title,
        project,
        plugins: toPluginMetas(config.plugins),
        reporters: config.reporters,
      })
      const handle = await attach(page, { session, plugins: config.plugins })
      const stopStepCapture = installStepCapture(testInfo, session)

      await session.emit({
        type: 'test.start',
        metadata: { label: testInfo.title, titlePath: testInfo.titlePath },
      })

      await use(handle)

      const status = testInfo.status ?? 'failed'
      if (status !== 'passed' && status !== 'skipped') {
        await handle.snapshot().catch(() => {})
      }
      await session.emit({
        type: 'test.end',
        metadata: {
          label: testInfo.title,
          titlePath: testInfo.titlePath,
          status,
          duration: testInfo.duration,
          error: testInfo.error?.message,
        },
      })

      stopStepCapture()
      await handle.detach()
      await session.finalize({ status })
    },
    { auto: true },
  ],
})

export { expect }
