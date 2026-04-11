import { test as base } from '@playwright/test'
import type { TestType, PlaywrightTestArgs, PlaywrightWorkerArgs } from '@playwright/test'
import type { SessionWriter, IntrospectionPlugin, PluginMeta } from '@introspection/types'
import { createSessionWriter } from '@introspection/write'
import { attach } from './attach.js'

export interface SessionOptions {
  plugins?: IntrospectionPlugin[]
  label?: string
  outDir?: string
}

export interface SessionContext {
  test: TestType<PlaywrightTestArgs, PlaywrightWorkerArgs>
  attach: typeof attach
}

export function session(
  options: SessionOptions,
  callback: (context: SessionContext) => void,
): void {
  const plugins = options.plugins ?? []
  const pluginMetas: PluginMeta[] = plugins
    .map(({ name, description, events, options }) => {
      const meta: PluginMeta = { name }
      if (description) meta.description = description
      if (events) meta.events = events
      if (options) meta.options = options
      return meta
    })

  let sessionRef: SessionWriter | null = null

  base.describe(options.label ?? 'session', () => {
    base.beforeAll(async () => {
      sessionRef = await createSessionWriter({
        outDir: options.outDir,
        label: options.label,
        plugins: pluginMetas.length > 0 ? pluginMetas : undefined,
      })
    })

    base.afterAll(async () => {
      if (sessionRef) {
        await sessionRef.finalize()
        sessionRef = null
      }
    })

    // Create a proxied test that emits lifecycle events
    const proxiedTest = createProxiedTest(base, () => sessionRef, plugins)

    // Bound attach that uses the session
    const boundAttach: typeof attach = (page, options = {}) => {
      if (!sessionRef) throw new Error('session not initialized — attach must be called inside a test')
      return attach(page, { ...options, session: sessionRef, plugins })
    }

    callback({ test: proxiedTest, attach: boundAttach })
  })
}

function createProxiedTest(
  original: TestType<PlaywrightTestArgs, PlaywrightWorkerArgs>,
  getSession: () => SessionWriter | null,
  plugins: IntrospectionPlugin[],
): TestType<PlaywrightTestArgs, PlaywrightWorkerArgs> {
  // Wrap test(name, fn) to emit test.start/test.end and auto-attach page
  const wrapped = function testWrapper(title: string, fn: (...args: unknown[]) => Promise<void>) {
    original(title, async (fixtures, testInfo) => {
      const currentSession = getSession()
      if (!currentSession) throw new Error('session not initialized')

      const titlePath = testInfo.titlePath

      currentSession.emit({
        type: 'test.start',
        source: 'playwright',
        data: { label: title, titlePath },
      })

      // Auto-attach the page to the session
      const handle = await attach(fixtures.page, { session: currentSession, plugins })

      try {
        await fn({ ...fixtures, page: handle.page }, testInfo)
      } finally {
        const status = testInfo.status ?? 'failed'

        // Auto-snapshot on failure
        if (status !== 'passed' && status !== 'skipped') {
          await handle.snapshot().catch(() => {})
        }

        await handle.detach()

        currentSession.emit({
          type: 'test.end',
          source: 'playwright',
          data: {
            label: title,
            titlePath,
            status,
            duration: testInfo.duration,
            error: testInfo.error?.message,
          },
        })
      }
    })
  } as unknown as TestType<PlaywrightTestArgs, PlaywrightWorkerArgs>

  // Proxy test.describe to emit describe.start/describe.end
  wrapped.describe = function describeWrapper(title: string, fn: () => void) {
    original.describe(title, () => {
      original.beforeAll(async () => {
        const currentSession = getSession()
        if (currentSession) {
          currentSession.emit({
            type: 'describe.start',
            source: 'playwright',
            data: { label: title },
          })
        }
      })

      fn()

      original.afterAll(async () => {
        const currentSession = getSession()
        if (currentSession) {
          currentSession.emit({
            type: 'describe.end',
            source: 'playwright',
            data: { label: title },
          })
        }
      })
    })
  } as typeof original.describe

  // Forward describe variants
  wrapped.describe.serial = function serialWrapper(title: string, fn: () => void) {
    original.describe.serial(title, () => {
      original.beforeAll(async () => {
        const currentSession = getSession()
        if (currentSession) {
          currentSession.emit({ type: 'describe.start', source: 'playwright', data: { label: title } })
        }
      })

      fn()

      original.afterAll(async () => {
        const currentSession = getSession()
        if (currentSession) {
          currentSession.emit({ type: 'describe.end', source: 'playwright', data: { label: title } })
        }
      })
    })
  } as typeof original.describe.serial

  wrapped.describe.parallel = function parallelWrapper(title: string, fn: () => void) {
    original.describe.parallel(title, () => {
      original.beforeAll(async () => {
        const currentSession = getSession()
        if (currentSession) {
          currentSession.emit({ type: 'describe.start', source: 'playwright', data: { label: title } })
        }
      })

      fn()

      original.afterAll(async () => {
        const currentSession = getSession()
        if (currentSession) {
          currentSession.emit({ type: 'describe.end', source: 'playwright', data: { label: title } })
        }
      })
    })
  } as typeof original.describe.parallel

  // Forward other test methods
  wrapped.skip = original.skip as typeof wrapped.skip
  wrapped.only = original.only as typeof wrapped.only
  wrapped.beforeAll = original.beforeAll
  wrapped.afterAll = original.afterAll
  wrapped.beforeEach = original.beforeEach
  wrapped.afterEach = original.afterEach
  wrapped.use = original.use
  wrapped.expect = original.expect
  wrapped.describe.configure = original.describe.configure
  wrapped.describe.fixme = original.describe.fixme
  wrapped.describe.skip = original.describe.skip
  wrapped.describe.only = original.describe.only

  return wrapped
}
