// packages/browser/src/index.ts
// Note: uses crypto.randomUUID() (Web Crypto API) — available in all modern browsers and Node 19+.
// Do NOT import from Node's 'crypto' module — this bundle runs in the browser page.
import { rpc } from '@bigmistqke/rpc/websocket'
import type {
  BrowserAgent as IBrowserAgent, IntrospectionPlugin, PluginEvent,
  IntrospectionServerMethods,
} from '@introspection/types'

function makeId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? `evt-${crypto.randomUUID().slice(0, 8)}`
    : `evt-${Math.random().toString(36).slice(2, 10)}`
}

export class BrowserAgent implements IBrowserAgent {
  private plugins: IntrospectionPlugin[] = []

  constructor(
    private sessionId: string,
    private server: ReturnType<typeof rpc<IntrospectionServerMethods>>,
  ) {}

  use(plugin: IntrospectionPlugin): void {
    this.plugins.push(plugin)
    plugin.browser?.setup(this)
  }

  emit(event: Omit<PluginEvent, 'id' | 'ts' | 'source'>): void {
    const full: PluginEvent = { id: makeId(), ts: Date.now(), source: 'plugin' as const, ...event }
    // sessionId is always present — fixes the silent routing bug
    void this.server.event(this.sessionId, full)
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

  /**
   * Connect to the Vite introspection server from a browser page.
   *
   * BREAKING CHANGE from previous API:
   * - Was: connect(vitePort: number, sessionId, testTitle, testFile)
   * - Now: connect(url: string, sessionId: string)
   * - START_SESSION is no longer sent — the Playwright process owns session lifecycle.
   *   The Playwright attach() call must complete before this agent emits events.
   */
  static connect(url: string, sessionId: string): BrowserAgent {
    const ws = new (globalThis as never as { WebSocket: typeof WebSocket }).WebSocket(url)
    const server = rpc<IntrospectionServerMethods>(ws)
    return new BrowserAgent(sessionId, server)
  }
}
