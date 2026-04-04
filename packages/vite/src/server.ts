import { randomUUID } from 'crypto'
import { WebSocketServer } from 'ws'
import { expose, rpc, type RPC } from '@bigmistqke/rpc/websocket'
import type { Server } from 'http'
import type {
  TraceEvent, IntrospectionConfig, OnErrorSnapshot,
  IntrospectionServerMethods, PlaywrightClientMethods,
} from '@introspection/types'
import { initSessionDir, appendEvent, writeSnapshot, finalizeSession } from './session-writer.js'

export interface Session {
  id: string
  label?: string
  outDir: string
  startedAt: number
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
  const sessions = new Map<string, Session>()

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url === '/__introspection') {
      wss.handleUpgrade(req, socket as never, head, (ws) => {
        wss.emit('connection', ws, req)
      })
    }
    // Non-introspection paths (e.g. Vite HMR) are left for Vite's own upgrade handler
  })

  wss.on('connection', (ws) => {
    const playwrightProxy = rpc<PlaywrightClientMethods>(ws)

    expose<IntrospectionServerMethods>({
      startSession({ id, startedAt, label }) {
        const outDir = config.outDir ?? '.introspect'
        const session: Session = { id, label, outDir, startedAt, events: [], playwrightProxy }
        sessions.set(id, session)
        void initSessionDir(outDir, { id, startedAt, label })
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
          void appendEvent(session.outDir, sessionId, transformed, session.bodyMap)
        }
      },

      async endSession(sessionId, _outDir, _workerIndex) {
        const session = sessions.get(sessionId)
        if (!session) return
        try {
          const endEvent: TraceEvent = { id: randomUUID(), type: 'session.end', ts: Date.now() - session.startedAt, source: 'agent', data: {} }
          await appendEvent(session.outDir, sessionId, endEvent)
          await finalizeSession(session.outDir, sessionId, Date.now())
        } catch (err) {
          console.error('[introspection] failed to finalize session:', err)
        } finally {
          sessions.delete(sessionId)
        }
      },

      storeBody(sessionId, eventId, body) {
        const session = sessions.get(sessionId)
        if (!session) return
        if (!session.bodyMap) session.bodyMap = new Map()
        session.bodyMap.set(eventId, body)
      },

      async requestSnapshot(sessionId, trigger) {
        const session = sessions.get(sessionId)
        if (!session) return
        try {
          session.snapshot = await session.playwrightProxy.takeSnapshot(trigger)
          if (session.snapshot) void writeSnapshot(session.outDir, sessionId, session.snapshot)
        } catch (err) {
          console.error('[introspection] snapshot request failed:', err)
        }
      },
    }, { to: ws })
  })

  return {
    getSession: (id) => sessions.get(id),
    getSessions: () => [...sessions.values()],
    shutdown: () => { wss.close() },
  }
}
