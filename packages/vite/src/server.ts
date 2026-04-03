import { WebSocketServer } from 'ws'
import { expose, rpc, type RPC } from '@bigmistqke/rpc/websocket'
import type { Server } from 'http'
import type {
  TraceEvent, IntrospectionConfig, TestResult, OnErrorSnapshot,
  IntrospectionServerMethods, PlaywrightClientMethods,
} from '@introspection/types'

export interface Session {
  id: string
  testTitle: string
  testFile: string
  events: TraceEvent[]
  playwrightProxy: RPC<PlaywrightClientMethods>
  bodyMap?: Map<string, string>
  snapshot?: OnErrorSnapshot
}

export interface IntrospectionServer {
  getSession(id: string): Session | undefined
  getSessions(): Session[]
  shutdown(): void
}

export function createIntrospectionServer(
  httpServer: Server,
  config: IntrospectionConfig,
  resolveFrame?: (frame: import('@introspection/types').StackFrame) => import('@introspection/types').StackFrame
): IntrospectionServer {
  const wss = new WebSocketServer({ noServer: true })
  const rejectWss = new WebSocketServer({ noServer: true })
  const sessions = new Map<string, Session>()

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url === '/__introspection') {
      wss.handleUpgrade(req, socket as never, head, (ws) => {
        wss.emit('connection', ws, req)
      })
    } else {
      rejectWss.handleUpgrade(req, socket as never, head, (ws) => {
        ws.close(1008, 'Path not found')
      })
    }
  })

  wss.on('connection', (ws) => {
    const playwrightProxy = rpc<PlaywrightClientMethods>(ws)

    expose<IntrospectionServerMethods>({
      startSession({ id, testTitle, testFile }) {
        sessions.set(id, {
          id, testTitle, testFile,
          events: [],
          playwrightProxy,
        })
      },

      event(sessionId, event) {
        const session = sessions.get(sessionId)
        if (!session) return
        let transformed: TraceEvent | null = event
        for (const plugin of config.plugins ?? []) {
          if (!transformed) break
          transformed = plugin.server?.transformEvent(transformed) ?? transformed
        }
        if (transformed && config.capture?.ignore?.includes(transformed.type)) {
          transformed = null
        }
        if (transformed) {
          if (transformed.type === 'js.error' && resolveFrame) {
            transformed = {
              ...transformed,
              data: { ...transformed.data, stack: transformed.data.stack.map(resolveFrame) },
            }
          }
          session.events.push(transformed)
        }
      },

      async endSession(sessionId, result, outDir, workerIndex) {
        const session = sessions.get(sessionId)
        if (!session) return
        try {
          const { writeTrace } = await import('./trace-writer.js')
          await writeTrace(session, result, outDir, workerIndex)
        } catch (err) {
          console.error('[introspection] failed to write trace:', err)
        } finally {
          sessions.delete(sessionId)
        }
      },

      async requestSnapshot(sessionId, trigger) {
        const session = sessions.get(sessionId)
        if (!session) return
        try {
          session.snapshot = await session.playwrightProxy.takeSnapshot(trigger)
        } catch (err) {
          console.error('[introspection] snapshot request failed:', err)
        }
      },
    }, { to: ws })
  })

  return {
    getSession: (id) => sessions.get(id),
    getSessions: () => [...sessions.values()],
    shutdown: () => { wss.close(); rejectWss.close() },
  }
}
