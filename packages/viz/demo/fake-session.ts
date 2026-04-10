import type { SessionData } from '../src/index.js'

export const session: SessionData = {
  meta: {
    version: '2',
    id: 'demo-session',
    startedAt: Date.now() - 5000,
    endedAt: Date.now(),
    label: 'demo test run',
  },
  events: [
    {
      id: '1', type: 'playwright.action', timestamp: 0, source: 'playwright',
      data: { method: 'goto', args: ['https://example.com'] },
    },
    {
      id: '2', type: 'network.request', timestamp: 120, source: 'cdp',
      data: { url: 'https://example.com', method: 'GET', headers: {} },
    },
    {
      id: '3', type: 'network.response', timestamp: 350, source: 'cdp', initiator: '2',
      data: { url: 'https://example.com', status: 200, headers: {}, timing: { blocked: 5, dns: 10, connect: 15, send: 1, wait: 180, receive: 20 } },
    },
    {
      id: '4', type: 'playwright.action', timestamp: 400, source: 'playwright',
      data: { method: 'click', args: ['button.submit'] },
    },
    {
      id: '5', type: 'network.request', timestamp: 420, source: 'cdp',
      data: { url: 'https://example.com/api/submit', method: 'POST', headers: { 'content-type': 'application/json' } },
    },
    {
      id: '6', type: 'js.error', timestamp: 480, source: 'cdp',
      data: { message: 'TypeError: Cannot read properties of undefined (reading "id")', stack: [{ functionName: 'handleSubmit', file: 'src/app.ts', line: 42, column: 12 }] },
    },
    {
      id: '7', type: 'network.response', timestamp: 510, source: 'cdp', initiator: '5',
      data: { url: 'https://example.com/api/submit', status: 500, headers: {}, timing: { blocked: 2, dns: 0, connect: 0, send: 1, wait: 85, receive: 2 } },
    },
    {
      id: '8', type: 'console', timestamp: 520, source: 'plugin',
      data: { level: 'error', message: 'Unhandled error in submit handler' },
    },
    {
      id: '9', type: 'playwright.action', timestamp: 800, source: 'playwright',
      data: { method: 'screenshot', args: [] },
    },
    {
      id: '10', type: 'playwright.result', timestamp: 1200, source: 'playwright',
      data: { status: 'failed', duration: 1200, error: 'Test failed: expected 200 got 500' },
    },
  ] as SessionData['events'],
  readAsset: async () => '(no assets in demo)',
}
