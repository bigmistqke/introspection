import { test, expect } from '@playwright/test'
import type { TestInfo } from '@playwright/test'
import type { SessionWriter, EmitInput } from '@introspection/types'
import { installStepCapture } from '../src/step-capture.js'

function fakeSession(): { writer: SessionWriter; emitted: EmitInput[] } {
  const emitted: EmitInput[] = []
  const writer = { emit: async (e: EmitInput) => { emitted.push(e) } } as unknown as SessionWriter
  return { writer, emitted }
}

test('wraps onStepBegin/onStepEnd, emits step events, calls originals, restores on stop', () => {
  const calls: string[] = []
  const callbacks: { onStepBegin: (p?: unknown) => void; onStepEnd: (p?: unknown) => void } = {
    onStepBegin: () => { calls.push('begin') },
    onStepEnd: () => { calls.push('end') },
  }
  const originals = { begin: callbacks.onStepBegin, end: callbacks.onStepEnd }
  const testInfo = { _callbacks: callbacks } as unknown as TestInfo
  const { writer, emitted } = fakeSession()

  const stop = installStepCapture(testInfo, writer)
  callbacks.onStepBegin({ stepId: 's@1', parentStepId: undefined, title: 'click', category: 'test.step' } as never)
  callbacks.onStepEnd({ stepId: 's@1', error: { message: 'boom' } } as never)

  expect(calls).toEqual(['begin', 'end'])  // originals still invoked
  expect(emitted).toEqual([
    { type: 'step.start', metadata: { stepId: 's@1', parentStepId: undefined, title: 'click', category: 'test.step' } },
    { type: 'step.end', metadata: { stepId: 's@1', error: 'boom' } },
  ])

  stop()
  expect(callbacks.onStepBegin).toBe(originals.begin)  // restored
  expect(callbacks.onStepEnd).toBe(originals.end)
})

test('throws a clear error when the internal hook is absent', () => {
  const { writer } = fakeSession()
  expect(() => installStepCapture({} as TestInfo, writer)).toThrow(/internal step hook/i)
})
