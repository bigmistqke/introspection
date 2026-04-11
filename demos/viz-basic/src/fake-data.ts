import type { StorageAdapter } from '@introspection/read'

const meta = JSON.stringify({
  version: '2',
  id: 'demo-session',
  startedAt: Date.now() - 5000,
  endedAt: Date.now(),
  label: 'checkout flow',
})

const events = [
  { id: '1', type: 'playwright.action', timestamp: 0, source: 'playwright', data: { method: 'goto', args: ['https://shop.test/cart'] } },
  { id: '2', type: 'network.request', timestamp: 80, source: 'cdp', data: { url: 'https://shop.test/api/cart', method: 'GET', headers: {} } },
  { id: '3', type: 'network.response', timestamp: 250, source: 'cdp', initiator: '2', data: { url: 'https://shop.test/api/cart', status: 200, headers: {} } },
  { id: '4', type: 'playwright.action', timestamp: 400, source: 'playwright', data: { method: 'click', args: ['button.checkout'] } },
  { id: '5', type: 'network.request', timestamp: 420, source: 'cdp', data: { url: 'https://shop.test/api/checkout', method: 'POST', headers: {} } },
  { id: '6', type: 'js.error', timestamp: 480, source: 'cdp', data: { message: 'TypeError: Cannot read properties of undefined (reading "id")', stack: [{ functionName: 'handleSubmit', file: 'src/app.ts', line: 42, column: 12 }] } },
  { id: '7', type: 'network.response', timestamp: 510, source: 'cdp', initiator: '5', data: { url: 'https://shop.test/api/checkout', status: 500, headers: {} } },
  { id: '8', type: 'console', timestamp: 520, source: 'plugin', data: { level: 'error', message: 'Unhandled error in submit handler' } },
  { id: '9', type: 'playwright.action', timestamp: 800, source: 'playwright', data: { method: 'screenshot', args: [] } },
  { id: '10', type: 'playwright.result', timestamp: 1200, source: 'playwright', data: { status: 'failed', duration: 1200, error: 'Test failed: expected 200 got 500' } },
]

const eventsNdjson = events.map(event => JSON.stringify(event)).join('\n')

const files: Record<string, string> = {
  'demo-session/meta.json': meta,
  'demo-session/events.ndjson': eventsNdjson,
}

export const adapter: StorageAdapter = {
  async listDirectories() {
    return ['demo-session']
  },
  async readText(path: string) {
    const content = files[path]
    if (content === undefined) throw new Error(`File not found: ${path}`)
    return content
  },
  async fileSize(path: string) {
    const content = files[path]
    if (content === undefined) throw new Error(`File not found: ${path}`)
    return content.length
  },
}
