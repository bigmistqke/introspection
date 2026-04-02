import type { Plugin, ViteDevServer } from 'vite'
import type { IntrospectionConfig, StackFrame } from '@introspection/types'
import { createIntrospectionServer, type IntrospectionServer } from './server.js'
// @ts-ignore
import { resolveStackFrame, viteSourceMapProvider } from './source-maps.js'

export function introspection(config: IntrospectionConfig = {}): Plugin {
  let server: IntrospectionServer | undefined

  return {
    name: 'introspection',
    configureServer(viteServer: ViteDevServer) {
      if (!viteServer.httpServer) return
      const resolveFrame = (frame: StackFrame) =>
        resolveStackFrame(frame, viteSourceMapProvider((id: string) => viteServer.moduleGraph.getModuleById(id)))
      server = createIntrospectionServer(viteServer.httpServer, config, resolveFrame)
      viteServer.httpServer.once('close', () => server?.shutdown())
    },
  }
}

export type { IntrospectionServer, Session } from './server.js'
