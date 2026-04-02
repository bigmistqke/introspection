// packages/browser/src/index.ts
// Note: uses crypto.randomUUID() (Web Crypto API) — available in all modern browsers and Node 19+.
// Do NOT import from Node's 'crypto' module — this bundle runs in the browser page.
import type { BrowserAgent as IBrowserAgent, IntrospectionPlugin, PluginEvent } from '@introspection/types'

function makeId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? `evt-${crypto.randomUUID().slice(0, 8)}`
    : `evt-${Math.random().toString(36).slice(2, 10)}`
}

interface AgentTransport { send(message: string): void }

export class BrowserAgent implements IBrowserAgent {
  private plugins: IntrospectionPlugin[] = []

  constructor(private transport: AgentTransport) {}

  use(plugin: IntrospectionPlugin): void {
    this.plugins.push(plugin)
    plugin.browser?.setup(this)
  }

  emit(event: Omit<PluginEvent, 'id' | 'ts' | 'source'>): void {
    const full = { id: makeId(), ts: Date.now(), source: 'plugin' as const, ...event }
    this.transport.send(JSON.stringify({ type: 'EVENT', event: full }))
  }

  collectSnapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const plugin of this.plugins) {
      if (plugin.browser?.snapshot) {
        try { result[plugin.name] = plugin.browser.snapshot() } catch { /* non-fatal */ }
      }
    }
    return result
  }

  /** Call this from the page to connect to the Vite plugin WS */
  static connect(vitePort = 5173, sessionId: string, testTitle = 'browser-agent', testFile = ''): BrowserAgent {
    const ws = new (globalThis as never as { WebSocket: typeof WebSocket }).WebSocket(
      `ws://localhost:${vitePort}/__introspection`
    )
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'START_SESSION', sessionId, testTitle, testFile }))
    })
    return new BrowserAgent({ send: (msg) => ws.send(msg) })
  }
}
