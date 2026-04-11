import type { BaseEvent } from '@introspection/types'

export interface WebGLContextCreatedEvent extends BaseEvent {
  type: 'webgl.context-created'
  data: { contextId: string }
}

export interface WebGLContextLostEvent extends BaseEvent {
  type: 'webgl.context-lost'
  data: { contextId: string }
}

export interface WebGLContextRestoredEvent extends BaseEvent {
  type: 'webgl.context-restored'
  data: { contextId: string }
}

export interface WebGLUniformEvent extends BaseEvent {
  type: 'webgl.uniform'
  data: { contextId: string; name: string; value: unknown; glType: string }
}

export interface WebGLDrawArraysEvent extends BaseEvent {
  type: 'webgl.draw-arrays'
  data: { contextId: string; primitive: string; first: number; count: number }
}

export interface WebGLDrawElementsEvent extends BaseEvent {
  type: 'webgl.draw-elements'
  data: { contextId: string; primitive: string; count: number; indexType: string; offset: number }
}

export interface WebGLTextureBindEvent extends BaseEvent {
  type: 'webgl.texture-bind'
  data: { contextId: string; unit: number; target: string; textureId: number | null }
}

declare module '@introspection/types' {
  interface TraceEventMap {
    'webgl.context-created': WebGLContextCreatedEvent
    'webgl.context-lost': WebGLContextLostEvent
    'webgl.context-restored': WebGLContextRestoredEvent
    'webgl.uniform': WebGLUniformEvent
    'webgl.draw-arrays': WebGLDrawArraysEvent
    'webgl.draw-elements': WebGLDrawElementsEvent
    'webgl.texture-bind': WebGLTextureBindEvent
  }
}
