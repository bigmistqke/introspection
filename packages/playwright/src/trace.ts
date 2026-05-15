import { test as base } from '@playwright/test'
import type { TestType, PlaywrightTestArgs, PlaywrightWorkerArgs } from '@playwright/test'
import type { TraceWriter, IntrospectionPlugin } from '@introspection/types'
import { createTraceWriter } from '@introspection/write'
import { attach, toPluginMetas } from './attach.js'

export interface TraceOptions {
  plugins?: IntrospectionPlugin[]
  label?: string
  outDir?: string
}

export interface TraceContext {
  test: TestType<PlaywrightTestArgs, PlaywrightWorkerArgs>
  attach: typeof attach
}

export function trace(
  options: TraceOptions,
  callback: (context: TraceContext) => void,
): void {
  const plugins = options.plugins ?? []
  const pluginMetas = toPluginMetas(plugins)

  let traceRef: TraceWriter | null = null

  base.describe(options.label ?? 'trace', () => {
    base.beforeAll(async () => {
      traceRef = await createTraceWriter({
        outDir: options.outDir,
        label: options.label,
        plugins: pluginMetas.length > 0 ? pluginMetas : undefined,
      })
    })

    base.afterAll(async () => {
      if (traceRef) {
        await traceRef.finalize()
        traceRef = null
      }
    })

    // Create a proxied test that emits lifecycle events
    const proxiedTest = createProxiedTest(base, () => traceRef, plugins)

    // Bound attach that uses the trace
    const boundAttach: typeof attach = (page, options = {}) => {
      if (!traceRef) throw new Error('trace not initialized — attach must be called inside a test')
      return attach(page, { ...options, trace: traceRef, plugins })
    }

    callback({ test: proxiedTest, attach: boundAttach })
  })
}

function createProxiedTest(
  original: TestType<PlaywrightTestArgs, PlaywrightWorkerArgs>,
  getTrace: () => TraceWriter | null,
  plugins: IntrospectionPlugin[],
): TestType<PlaywrightTestArgs, PlaywrightWorkerArgs> {
  // Wrap test(name, fn) to emit test.start/test.end and auto-attach page
  const wrapped = function testWrapper(title: string, fn: (...args: unknown[]) => Promise<void>) {
    original(title, async (fixtures, testInfo) => {
      const currentTrace = getTrace()
      if (!currentTrace) throw new Error('trace not initialized')

      const titlePath = testInfo.titlePath

      currentTrace.emit({
        type: 'test.start',
        metadata: { label: title, titlePath },
      })

      // Auto-attach the page to the trace
      const handle = await attach(fixtures.page, { trace: currentTrace, plugins })

      try {
        await fn({ ...fixtures, page: handle.page }, testInfo)
      } finally {
        const status = testInfo.status ?? 'failed'

        // Auto-snapshot on failure
        if (status !== 'passed' && status !== 'skipped') {
          await handle.snapshot().catch(() => {})
        }

        await handle.detach()

        currentTrace.emit({
          type: 'test.end',
          metadata: {
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

  function wrapDescribe(
    describeVariant: (title: string, fn: () => void) => void,
    title: string,
    fn: () => void,
  ) {
    describeVariant(title, () => {
      original.beforeAll(async () => {
        getTrace()?.emit({ type: 'describe.start', metadata: { label: title } })
      })
      fn()
      original.afterAll(async () => {
        getTrace()?.emit({ type: 'describe.end', metadata: { label: title } })
      })
    })
  }

  // Proxy test.describe to emit describe.start/describe.end
  wrapped.describe = ((title: string, fn: () => void) => {
    wrapDescribe(original.describe, title, fn)
  }) as typeof original.describe

  // Forward describe variants
  wrapped.describe.serial = ((title: string, fn: () => void) => {
    wrapDescribe(original.describe.serial, title, fn)
  }) as typeof original.describe.serial

  wrapped.describe.parallel = ((title: string, fn: () => void) => {
    wrapDescribe(original.describe.parallel, title, fn)
  }) as typeof original.describe.parallel

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
