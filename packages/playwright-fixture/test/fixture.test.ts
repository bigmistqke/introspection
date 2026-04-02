import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @introspection/playwright attach
const { mockAttach, mockMark, mockDetach } = vi.hoisted(() => ({
  mockAttach: vi.fn(),
  mockMark: vi.fn(),
  mockDetach: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@introspection/playwright', () => ({
  attach: mockAttach,
}))

// Mock @playwright/test — test.extend() stores fixtures and returns them for inspection
const capturedFixtures = vi.hoisted(() => ({} as Record<string, unknown>))
vi.mock('@playwright/test', () => ({
  test: {
    extend: (fixtures: Record<string, unknown>) => {
      Object.assign(capturedFixtures, fixtures)
      return { _isExtended: true, fixtures: capturedFixtures }
    },
  },
  expect,
}))

import { introspectFixture } from '../src/index.js'

describe('introspectFixture()', () => {
  beforeEach(() => {
    mockAttach.mockReset()
    mockDetach.mockReset()
    mockDetach.mockResolvedValue(undefined)
    mockAttach.mockResolvedValue({
      page: {},
      mark: mockMark,
      snapshot: vi.fn().mockResolvedValue(undefined),
      detach: mockDetach,
    })
  })

  it('returns an object with test and expect', () => {
    const result = introspectFixture()
    expect(result).toHaveProperty('test')
    expect(result).toHaveProperty('expect')
  })

  it('fixture setup calls attach with testInfo metadata', async () => {
    introspectFixture()
    // The introspect fixture is [fn, { auto: true }]
    const [fixtureFn] = capturedFixtures.introspect as [Function, unknown]

    const fakeUse = vi.fn().mockResolvedValue(undefined)
    const fakePage = {}
    const fakeTestInfo = {
      title: 'my test',
      file: 'my.spec.ts',
      workerIndex: 0,
      status: 'passed' as const,
      duration: 500,
      error: undefined,
    }

    await fixtureFn({ page: fakePage }, fakeUse, fakeTestInfo)

    expect(mockAttach).toHaveBeenCalledWith(fakePage, expect.objectContaining({
      testTitle: 'my test',
      testFile: 'my.spec.ts',
      workerIndex: 0,
    }))
  })

  it('fixture calls use() with the handle', async () => {
    introspectFixture()
    const [fixtureFn] = capturedFixtures.introspect as [Function, unknown]

    const fakeUse = vi.fn().mockResolvedValue(undefined)
    const fakePage = {}
    const fakeTestInfo = { title: 't', file: 'f.spec.ts', workerIndex: 0, status: 'passed' as const, duration: 100, error: undefined }

    await fixtureFn({ page: fakePage }, fakeUse, fakeTestInfo)

    expect(fakeUse).toHaveBeenCalledOnce()
    expect(fakeUse.mock.calls[0][0]).toHaveProperty('detach')
  })

  it('fixture teardown calls detach with test result', async () => {
    introspectFixture()
    const [fixtureFn] = capturedFixtures.introspect as [Function, unknown]

    const fakeUse = vi.fn().mockResolvedValue(undefined)
    const fakePage = {}
    const fakeTestInfo = {
      title: 't',
      file: 'f.spec.ts',
      workerIndex: 1,
      status: 'failed' as const,
      duration: 200,
      error: { message: 'boom' },
    }

    await fixtureFn({ page: fakePage }, fakeUse, fakeTestInfo)

    expect(mockDetach).toHaveBeenCalledWith({
      status: 'failed',
      duration: 200,
      error: 'boom',
    })
  })
})
