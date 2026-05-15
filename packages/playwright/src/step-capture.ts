import type { TestInfo } from '@playwright/test'
import type { TraceWriter } from '@introspection/types'

interface StepBeginPayload {
  stepId: string
  parentStepId?: string
  title: string
  category: string
}
interface StepEndPayload {
  stepId: string
  error?: { message?: string }
}
interface TestInfoCallbacks {
  onStepBegin: (payload: StepBeginPayload) => void
  onStepEnd: (payload: StepEndPayload) => void
}

/**
 * Wraps Playwright's internal worker-side step callbacks so step boundaries
 * become `step.start` / `step.end` events on the trace bus. Verified against
 * Playwright's `TestInfoImpl._callbacks` (>=1.49 <=1.59). If the hook is
 * absent, throws — there is no fallback (see spec §"Step capture").
 *
 * Returns a `stop()` that restores the original callbacks.
 */
export function installStepCapture(testInfo: TestInfo, trace: TraceWriter): () => void {
  const callbacks = (testInfo as unknown as { _callbacks?: Partial<TestInfoCallbacks> })._callbacks
  if (!callbacks || typeof callbacks.onStepBegin !== 'function' || typeof callbacks.onStepEnd !== 'function') {
    throw new Error(
      "@introspection/playwright: Playwright's internal step hook " +
        '(testInfo._callbacks.onStepBegin/onStepEnd) was not found. This build is ' +
        'verified against Playwright >=1.49 <=1.59. Pin a supported Playwright ' +
        'version or file an issue at @introspection/playwright.',
    )
  }

  const originalBegin = callbacks.onStepBegin
  const originalEnd = callbacks.onStepEnd

  callbacks.onStepBegin = (payload: StepBeginPayload) => {
    void trace.emit({
      type: 'step.start',
      metadata: {
        stepId: payload.stepId,
        parentStepId: payload.parentStepId,
        title: payload.title,
        category: payload.category,
      },
    })
    return originalBegin(payload)
  }
  callbacks.onStepEnd = (payload: StepEndPayload) => {
    void trace.emit({
      type: 'step.end',
      metadata: { stepId: payload.stepId, error: payload.error?.message },
    })
    return originalEnd(payload)
  }

  return () => {
    callbacks.onStepBegin = originalBegin
    callbacks.onStepEnd = originalEnd
  }
}
