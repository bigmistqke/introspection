import { WebSocketServer, type WebSocket } from 'ws'
import type { Server } from 'http'
import type { TraceEvent, IntrospectionConfig, TraceTest } from '@introspection/types'

export interface Session {
  id: string
  testTitle: string
  testFile: string
  startedAt: number
  events: TraceEvent[]
  ws: WebSocket
  bodyMap?: Map<string, string>
  snapshot?: import('@introspection/types').OnErrorSnapshot
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
      // Perform a proper WebSocket upgrade then immediately close so the
      // client receives a clean close frame (no unhandled error events)
      rejectWss.handleUpgrade(req, socket as never, head, (ws) => {
        ws.close(1008, 'Path not found')
      })
    }
  })

  wss.on('connection', (ws) => {
    ws.on('message', async (raw) => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(raw.toString()) } catch { return }

      if (msg.type === 'START_SESSION') {
        const session: Session = {
          id: msg.sessionId as string,
          testTitle: msg.testTitle as string,
          testFile: msg.testFile as string,
          startedAt: Date.now(),
          events: [],
          ws,
        }
        sessions.set(session.id, session)

      } else if (msg.type === 'EVENT') {
        const session = sessions.get(msg.sessionId as string)
        if (session) {
          let transformed: TraceEvent | null = msg.event as TraceEvent
          // Apply server-side plugin transforms
          for (const plugin of config.plugins ?? []) {
            if (!transformed) break
            transformed = plugin.server?.transformEvent(transformed) ?? transformed
          }
          // Apply capture.ignore filter
          if (transformed && config.capture?.ignore?.includes(transformed.type)) {
            transformed = null
          }
          if (transformed) {
            // Source-map js.error stacks
            if (transformed.type === 'js.error' && resolveFrame) {
              transformed = {
                ...transformed,
                data: { ...transformed.data, stack: transformed.data.stack.map(resolveFrame) }
              }
            }
            session.events.push(transformed)
          }
        }

      } else if (msg.type === 'SNAPSHOT_REQUEST') {
        const session = sessions.get(msg.sessionId as string)
        if (session) {
          session.ws.send(JSON.stringify({ type: 'TAKE_SNAPSHOT', trigger: msg.trigger }))
        }

      } else if (msg.type === 'SNAPSHOT') {
        const session = sessions.get(msg.sessionId as string)
        if (session) {
          session.snapshot = msg.snapshot as import('@introspection/types').OnErrorSnapshot
        }

      } else if (msg.type === 'END_SESSION') {
        const session = sessions.get(msg.sessionId as string)
        if (session) {
          const result = (msg.result as { status: string; error?: string }) ?? { status: 'passed' }
          const outDir = (msg.outDir as string) ?? '.introspect'
          const workerIndex = (msg.workerIndex as number) ?? 0
          const { writeTrace } = await import('./trace-writer.js')
          await writeTrace(session, result as never, outDir, workerIndex)
          sessions.delete(session.id)
        }
      }
    })
  })

  return {
    getSession: (id) => sessions.get(id),
    getSessions: () => [...sessions.values()],
    shutdown: () => { wss.close(); rejectWss.close() },
  }
}
