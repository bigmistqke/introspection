import type { IntrospectionPlugin, BrowserAgent } from '@introspection/types'

export interface WebGLPlugin extends IntrospectionPlugin {
  track<T extends WebGLRenderingContext | WebGL2RenderingContext>(gl: T): T
  frame(): void
  stateSnapshot(): void
}

export function createWebGLPlugin(): WebGLPlugin {
  throw new Error('not implemented')
}
