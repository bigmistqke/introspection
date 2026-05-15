import { test, expect } from '@playwright/test'
import type { RunMeta, TraceMeta, StepStartEvent, StepEndEvent } from '@introspection/types'

test('RunMeta and extended TraceMeta have the expected shape', () => {
  const run: RunMeta = {
    version: '1', id: 'r1', startedAt: 1, endedAt: 2, status: 'passed', branch: 'main', commit: 'abc',
  }
  const trace: TraceMeta = {
    version: '2', id: 's1', startedAt: 1, status: 'failed', project: 'browser-mobile',
  }
  expect(run.status).toBe('passed')
  expect(trace.project).toBe('browser-mobile')

  const start: StepStartEvent = {
    id: 'e1', type: 'step.start', timestamp: 0,
    metadata: { stepId: 's@1', parentStepId: undefined, title: 'click', category: 'test.step' },
  }
  const end: StepEndEvent = { id: 'e2', type: 'step.end', timestamp: 1, metadata: { stepId: 's@1' } }
  expect(start.type).toBe('step.start')
  expect(end.metadata.stepId).toBe('s@1')
})
