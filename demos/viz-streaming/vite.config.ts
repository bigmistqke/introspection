import { defineConfig } from 'vite'

const events = [
  { id: '1', type: 'playwright.action', timestamp: 0, source: 'playwright', data: { method: 'goto', args: ['https://shop.test/'] } },
  { id: '2', type: 'network.request', timestamp: 80, source: 'cdp', data: { url: 'https://shop.test/', method: 'GET', headers: {} } },
  { id: '3', type: 'network.response', timestamp: 320, source: 'cdp', initiator: '2', data: { url: 'https://shop.test/', status: 200, headers: {} } },
  { id: '4', type: 'playwright.action', timestamp: 500, source: 'playwright', data: { method: 'fill', args: ['input[name=search]', 'laptop'] } },
  { id: '5', type: 'network.request', timestamp: 550, source: 'cdp', data: { url: 'https://shop.test/api/search?q=laptop', method: 'GET', headers: {} } },
  { id: '6', type: 'network.request', timestamp: 560, source: 'cdp', data: { url: 'https://shop.test/api/suggestions?q=laptop', method: 'GET', headers: {} } },
  { id: '7', type: 'network.response', timestamp: 700, source: 'cdp', initiator: '6', data: { url: 'https://shop.test/api/suggestions?q=laptop', status: 200, headers: {} } },
  { id: '8', type: 'network.response', timestamp: 900, source: 'cdp', initiator: '5', data: { url: 'https://shop.test/api/search?q=laptop', status: 200, headers: {} } },
  { id: '9', type: 'playwright.action', timestamp: 1100, source: 'playwright', data: { method: 'click', args: ['.product-card:first-child'] } },
  { id: '10', type: 'browser.navigate', timestamp: 1150, source: 'cdp', data: { from: 'https://shop.test/', to: 'https://shop.test/products/42' } },
  { id: '11', type: 'network.request', timestamp: 1180, source: 'cdp', data: { url: 'https://shop.test/api/products/42', method: 'GET', headers: {} } },
  { id: '12', type: 'network.response', timestamp: 1400, source: 'cdp', initiator: '11', data: { url: 'https://shop.test/api/products/42', status: 200, headers: {} } },
  { id: '13', type: 'playwright.action', timestamp: 1600, source: 'playwright', data: { method: 'click', args: ['button.add-to-cart'] } },
  { id: '14', type: 'network.request', timestamp: 1620, source: 'cdp', data: { url: 'https://shop.test/api/cart', method: 'POST', headers: {} } },
  { id: '15', type: 'js.error', timestamp: 1650, source: 'cdp', data: { message: 'TypeError: Cannot read properties of null (reading "quantity")', stack: [{ functionName: 'addToCart', file: 'src/cart.ts', line: 55, column: 12 }] } },
  { id: '16', type: 'network.response', timestamp: 1700, source: 'cdp', initiator: '14', data: { url: 'https://shop.test/api/cart', status: 500, headers: {} } },
  { id: '17', type: 'console', timestamp: 1710, source: 'plugin', data: { level: 'error', message: 'Failed to add item to cart' } },
  { id: '18', type: 'playwright.result', timestamp: 2000, source: 'playwright', data: { status: 'failed', duration: 2000, error: 'Test failed: cart count did not update' } },
]

export default defineConfig({
  plugins: [
    {
      name: 'sse-events',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url !== '/events') return next()

          response.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          })

          let index = 0
          let closed = false

          function sendNext() {
            if (closed) return
            if (index >= events.length) {
              response.write('event: done\ndata: {}\n\n')
              return
            }

            const event = events[index]
            const nextEvent = events[index + 1]
            response.write(`data: ${JSON.stringify(event)}\n\n`)
            index++

            if (nextEvent) {
              const delay = (nextEvent.timestamp - event.timestamp) * 3
              setTimeout(sendNext, Math.max(delay, 50))
            } else {
              setTimeout(sendNext, 300)
            }
          }

          sendNext()

          request.on('close', () => { closed = true })
        })
      },
    },
  ],
})
