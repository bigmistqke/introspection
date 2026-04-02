import type { Plugin, ViteDevServer } from 'vite'
import type { IntrospectionConfig, StackFrame } from '@introspection/types'
import { createIntrospectionServer, type IntrospectionServer } from './server.js'
import { resolveStackFrame, viteSourceMapProvider } from './source-maps.js'
import { createEvalSocket, type EvalSocket } from './eval-socket.js'
import { join } from 'path'

export function introspection(config: IntrospectionConfig = {}): Plugin {
  let server: IntrospectionServer | undefined
  let evalSocket: EvalSocket | undefined
  const outDir = config.outDir ?? '.introspect'

  return {
    name: 'introspection',
    configureServer(viteServer: ViteDevServer) {
      if (!viteServer.httpServer) return
      const resolveFrame = (frame: StackFrame) =>
        resolveStackFrame(frame, viteSourceMapProvider((id: string) => viteServer.moduleGraph.getModuleById(id)))
      server = createIntrospectionServer(viteServer.httpServer, config, resolveFrame)
      evalSocket = createEvalSocket(join(outDir, '.socket'), () => server?.getSessions() ?? [], resolveFrame)
      viteServer.httpServer.once('close', async () => {
        server?.shutdown()
        await evalSocket?.shutdown()
      })
    },
  }
}

export type { IntrospectionServer, Session } from './server.js'
