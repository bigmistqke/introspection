import type { StorageAdapter } from '@introspection/read'

const now = Date.now()

const sessions: Record<string, { meta: Record<string, unknown>; events: Record<string, unknown>[] }> = {
  'checkout-flow': {
    meta: { version: '2', id: 'checkout-flow', startedAt: now - 12000, endedAt: now - 7000, label: 'checkout flow' },
    events: [
      { id: '1', type: 'playwright.action', timestamp: 0, source: 'playwright', data: { method: 'goto', args: ['https://shop.test/cart'] } },
      { id: '2', type: 'network.request', timestamp: 80, source: 'cdp', data: { url: 'https://shop.test/api/cart', method: 'GET', headers: {} } },
      { id: '3', type: 'network.response', timestamp: 250, source: 'cdp', initiator: '2', data: { url: 'https://shop.test/api/cart', status: 200, headers: {} } },
      { id: '4', type: 'playwright.action', timestamp: 500, source: 'playwright', data: { method: 'click', args: ['button.checkout'] } },
      { id: '5', type: 'network.request', timestamp: 520, source: 'cdp', data: { url: 'https://shop.test/api/checkout', method: 'POST', headers: {} } },
      { id: '6', type: 'network.response', timestamp: 900, source: 'cdp', initiator: '5', data: { url: 'https://shop.test/api/checkout', status: 201, headers: {} } },
      { id: '7', type: 'playwright.result', timestamp: 1500, source: 'playwright', data: { status: 'passed', duration: 1500 } },
    ],
  },
  'login-failure': {
    meta: { version: '2', id: 'login-failure', startedAt: now - 8000, endedAt: now - 3000, label: 'login with bad credentials' },
    events: [
      { id: '1', type: 'playwright.action', timestamp: 0, source: 'playwright', data: { method: 'goto', args: ['https://shop.test/login'] } },
      { id: '2', type: 'playwright.action', timestamp: 200, source: 'playwright', data: { method: 'fill', args: ['input[name=email]', 'user@test.com'] } },
      { id: '3', type: 'playwright.action', timestamp: 350, source: 'playwright', data: { method: 'click', args: ['button[type=submit]'] } },
      { id: '4', type: 'network.request', timestamp: 370, source: 'cdp', data: { url: 'https://shop.test/api/auth', method: 'POST', headers: {} } },
      { id: '5', type: 'network.response', timestamp: 530, source: 'cdp', initiator: '4', data: { url: 'https://shop.test/api/auth', status: 401, headers: {} } },
      { id: '6', type: 'js.error', timestamp: 550, source: 'cdp', data: { message: 'AuthError: Invalid credentials', stack: [{ functionName: 'handleLogin', file: 'src/auth.ts', line: 28, column: 8 }] } },
      { id: '7', type: 'playwright.result', timestamp: 1000, source: 'playwright', data: { status: 'failed', duration: 1000, error: 'Expected navigation to /dashboard' } },
    ],
  },
  'search-products': {
    meta: { version: '2', id: 'search-products', startedAt: now - 4000, endedAt: now - 500, label: 'product search' },
    events: [
      { id: '1', type: 'playwright.action', timestamp: 0, source: 'playwright', data: { method: 'goto', args: ['https://shop.test/'] } },
      { id: '2', type: 'playwright.action', timestamp: 150, source: 'playwright', data: { method: 'fill', args: ['input[name=search]', 'laptop'] } },
      { id: '3', type: 'network.request', timestamp: 200, source: 'cdp', data: { url: 'https://shop.test/api/search?q=laptop', method: 'GET', headers: {} } },
      { id: '4', type: 'network.response', timestamp: 480, source: 'cdp', initiator: '3', data: { url: 'https://shop.test/api/search?q=laptop', status: 200, headers: {} } },
      { id: '5', type: 'playwright.action', timestamp: 600, source: 'playwright', data: { method: 'click', args: ['.product-card:first-child'] } },
      { id: '6', type: 'playwright.result', timestamp: 1200, source: 'playwright', data: { status: 'passed', duration: 1200 } },
    ],
  },
}

function buildFiles(): Record<string, string> {
  const files: Record<string, string> = {}
  for (const [id, session] of Object.entries(sessions)) {
    files[`${id}/meta.json`] = JSON.stringify(session.meta)
    files[`${id}/events.ndjson`] = session.events.map(event => JSON.stringify(event)).join('\n')
  }
  return files
}

const files = buildFiles()

export const adapter: StorageAdapter = {
  async listDirectories() { return Object.keys(sessions) },
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

export const sessionIds = Object.keys(sessions)
