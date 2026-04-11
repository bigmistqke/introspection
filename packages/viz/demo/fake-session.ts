import type { SessionReader, TraceEvent, AssetEvent } from '@introspection/types'

const events: TraceEvent[] = [
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
] as TraceEvent[]

export const session: SessionReader = {
  id: 'demo-session',
  events: {
    ls: () => Promise.resolve(events),
    query: (filter) => {
      let result = events
      if (filter.type) {
        const types = filter.type.split(',').map(type => type.trim())
        result = result.filter(event => types.includes(event.type))
      }
      if (filter.source) {
        result = result.filter(event => event.source === filter.source)
      }
      return Promise.resolve(result)
    },
  },
  assets: {
    ls: () => Promise.resolve(events.filter((event): event is AssetEvent => event.type === 'asset')),
    read: async () => '(no assets in demo)',
  },
}
