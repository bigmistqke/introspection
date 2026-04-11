import type { StorageAdapter } from '@introspection/read'

const meta = JSON.stringify({
  version: '2',
  id: 'graph-session',
  startedAt: Date.now() - 5000,
  endedAt: Date.now(),
  label: 'graph demo',
})

// Events with rich initiator chains to visualize
const events = [
  { id: 'goto', type: 'playwright.action', timestamp: 0, source: 'playwright', data: { method: 'goto', args: ['https://shop.test/'] } },
  { id: 'nav', type: 'browser.navigate', timestamp: 20, source: 'cdp', initiator: 'goto', data: { from: '', to: 'https://shop.test/' } },
  { id: 'req-page', type: 'network.request', timestamp: 50, source: 'cdp', initiator: 'nav', data: { url: 'https://shop.test/', method: 'GET', headers: {} } },
  { id: 'req-css', type: 'network.request', timestamp: 80, source: 'cdp', initiator: 'nav', data: { url: 'https://shop.test/style.css', method: 'GET', headers: {} } },
  { id: 'req-js', type: 'network.request', timestamp: 90, source: 'cdp', initiator: 'nav', data: { url: 'https://shop.test/app.js', method: 'GET', headers: {} } },
  { id: 'res-css', type: 'network.response', timestamp: 200, source: 'cdp', initiator: 'req-css', data: { url: 'https://shop.test/style.css', status: 200, headers: {} } },
  { id: 'res-page', type: 'network.response', timestamp: 250, source: 'cdp', initiator: 'req-page', data: { url: 'https://shop.test/', status: 200, headers: {} } },
  { id: 'res-js', type: 'network.response', timestamp: 300, source: 'cdp', initiator: 'req-js', data: { url: 'https://shop.test/app.js', status: 200, headers: {} } },
  { id: 'req-api', type: 'network.request', timestamp: 400, source: 'cdp', initiator: 'res-js', data: { url: 'https://shop.test/api/products', method: 'GET', headers: {} } },
  { id: 'req-analytics', type: 'network.request', timestamp: 410, source: 'cdp', initiator: 'res-js', data: { url: 'https://analytics.test/track', method: 'POST', headers: {} } },
  { id: 'res-analytics', type: 'network.response', timestamp: 500, source: 'cdp', initiator: 'req-analytics', data: { url: 'https://analytics.test/track', status: 204, headers: {} } },
  { id: 'res-api', type: 'network.response', timestamp: 600, source: 'cdp', initiator: 'req-api', data: { url: 'https://shop.test/api/products', status: 200, headers: {} } },
  { id: 'click', type: 'playwright.action', timestamp: 800, source: 'playwright', data: { method: 'click', args: ['.product:first-child'] } },
  { id: 'req-detail', type: 'network.request', timestamp: 820, source: 'cdp', initiator: 'click', data: { url: 'https://shop.test/api/products/1', method: 'GET', headers: {} } },
  { id: 'error', type: 'js.error', timestamp: 850, source: 'cdp', initiator: 'click', data: { message: 'ReferenceError: productId is not defined', stack: [{ functionName: 'onClick', file: 'src/app.ts', line: 12, column: 5 }] } },
  { id: 'res-detail', type: 'network.response', timestamp: 950, source: 'cdp', initiator: 'req-detail', data: { url: 'https://shop.test/api/products/1', status: 200, headers: {} } },
  { id: 'result', type: 'playwright.result', timestamp: 1200, source: 'playwright', data: { status: 'failed', duration: 1200, error: 'ReferenceError: productId is not defined' } },
]

const eventsNdjson = events.map(event => JSON.stringify(event)).join('\n')

const files: Record<string, string> = {
  'graph-session/meta.json': meta,
  'graph-session/events.ndjson': eventsNdjson,
}

export const adapter: StorageAdapter = {
  async listDirectories() { return ['graph-session'] },
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
