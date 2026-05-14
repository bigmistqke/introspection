/// <reference path="./iife.d.ts" />
// Loaded as raw text by esbuild (tsup.node.config.ts sets loader['.iife.js'] = 'text').
// The import path is relative to src/ and resolved at build time — not a runtime path.
import BROWSER_SCRIPT from '../dist/browser.iife.js'
import type { IntrospectionPlugin, PluginContext, WatchHandle } from '@introspection/types'
import { createDebug } from '@introspection/utils'

export type {
  WebGLContextCreatedEvent, WebGLContextLostEvent, WebGLContextRestoredEvent,
  WebGLUniformEvent, WebGLDrawArraysEvent, WebGLDrawElementsEvent, WebGLTextureBindEvent,
} from '@introspection/types'

declare global {
  interface Window {
    __introspect_plugins__?: Record<string, unknown>
  }
}

export type NameFilter = string | RegExp

export interface WebGLOptions {
  verbose?: boolean
}

function serialiseName(name: NameFilter | undefined): string | { source: string; flags: string } | undefined {
  if (name === undefined) return undefined
  if (typeof name === 'string') return name
  return { source: name.source, flags: name.flags }
}

export interface UniformWatchOpts {
  event: 'uniform'
  contextId?: string
  name?: NameFilter
  valueChanged?: boolean
}

export interface DrawWatchOpts {
  event: 'draw'
  contextId?: string
  primitive?: 'TRIANGLES' | 'LINES' | 'POINTS' | 'LINE_STRIP' | 'LINE_LOOP' | 'TRIANGLE_STRIP' | 'TRIANGLE_FAN'
}

export interface TextureBindWatchOpts {
  event: 'texture-bind'
  contextId?: string
  unit?: number
}

export type WebGLWatchOpts = UniformWatchOpts | DrawWatchOpts | TextureBindWatchOpts

export interface WebGLStateSnapshot {
  contextId: string
  uniforms: Record<string, { value: unknown; glType: string }>
  textures: Array<{ unit: number; target: string; textureId: number | null }>
  viewport: [number, number, number, number]
  blendState: { enabled: boolean; srcRgb: number; dstRgb: number; srcAlpha: number; dstAlpha: number; equation: number }
  depthState: { testEnabled: boolean; func: number; writeMask: boolean }
}

export interface WebGLPlugin extends IntrospectionPlugin {
  watch(opts: WebGLWatchOpts): Promise<WatchHandle>
  captureCanvas(opts?: { contextId?: string }): Promise<void>
}

export function webgl(options?: WebGLOptions): WebGLPlugin {
  const debug = createDebug('plugin-webgl', options?.verbose ?? false)
  let pluginCtx: PluginContext | null = null

  async function captureState(ctx: PluginContext): Promise<void> {
    const captureTimestamp = ctx.timestamp()

    const snapshots = await ctx.page.evaluate(() => {
      return (window.__introspect_plugins__ as { webgl?: { getState?(): unknown[] } } | undefined)
        ?.webgl?.getState?.() ?? []
    }) as WebGLStateSnapshot[]

    const canvases = await ctx.page.evaluate(async () => {
      const plugin = (window.__introspect_plugins__ as {
        webgl?: { captureCanvases?(): Promise<Array<{ contextId: string; dataUrl: string }>> }
      } | undefined)?.webgl
      return plugin?.captureCanvases?.() ?? []
    })

    const assets = []

    for (const snapshot of snapshots) {
      const asset = await ctx.writeAsset({
        kind: 'json',
        content: JSON.stringify(snapshot),
      })
      assets.push(asset)
    }

    for (const { contextId, dataUrl } of canvases) {
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
      const asset = await ctx.writeAsset({
        kind: 'image',
        content: Buffer.from(base64, 'base64'),
        ext: 'png',
      })
      assets.push(asset)
    }

    if (assets.length > 0) {
      await ctx.emit({
        type: 'webgl.capture' as const,
        assets,
      })
    }
  }

  return {
    name: 'webgl',
    description: 'Captures WebGL state, uniforms, draw calls, textures, and canvas PNGs',
    events: {
      'webgl.context-created': 'New WebGL rendering context',
      'webgl.uniform': 'Uniform variable update',
      'webgl.draw-arrays': 'drawArrays call',
      'webgl.texture-bind': 'Texture bind to a texture unit',
    },
    script: BROWSER_SCRIPT,

    async install(ctx: PluginContext): Promise<void> {
      debug('installing')
      pluginCtx = ctx

      ctx.bus.on('manual', async () => {
        debug('capture triggered: manual')
        await captureState(ctx)
      })
      ctx.bus.on('js.error', async () => {
        debug('capture triggered: js.error')
        await captureState(ctx)
      })
      ctx.bus.on('detach', async () => {
        debug('capture triggered: detach')
        await captureState(ctx)
      })
    },

    async watch(opts: WebGLWatchOpts): Promise<WatchHandle> {
      if (!pluginCtx) throw new Error('webgl plugin: watch() called before install()')
      let specification: Record<string, unknown>
      if (opts.event === 'uniform') {
        specification = {
          event: 'uniform',
          ...(opts.contextId !== undefined && { contextId: opts.contextId }),
          ...(opts.name !== undefined && { name: serialiseName(opts.name) }),
          ...(opts.valueChanged !== undefined && { valueChanged: opts.valueChanged }),
        }
      } else if (opts.event === 'draw') {
        specification = {
          event: 'draw',
          ...(opts.contextId !== undefined && { contextId: opts.contextId }),
          ...(opts.primitive !== undefined && { primitive: opts.primitive }),
        }
      } else {
        specification = {
          event: 'texture-bind',
          ...(opts.contextId !== undefined && { contextId: opts.contextId }),
          ...((opts as TextureBindWatchOpts).unit !== undefined && { unit: (opts as TextureBindWatchOpts).unit }),
        }
      }
      return pluginCtx.addSubscription('webgl', specification)
    },

    async captureCanvas(opts?: { contextId?: string }): Promise<void> {
      if (!pluginCtx) throw new Error('webgl plugin: captureCanvas() called before install()')
      const captureTimestamp = pluginCtx.timestamp()
      let canvases: Array<{ contextId: string; dataUrl: string }>
      try {
        canvases = await pluginCtx.page.evaluate(async () => {
          const plugin = (window.__introspect_plugins__ as {
            webgl?: { captureCanvases?(): Promise<Array<{ contextId: string; dataUrl: string }>> }
          } | undefined)?.webgl
          if (!plugin?.captureCanvases) {
            return []
          }
          return await plugin.captureCanvases()
        })
      } catch (error) {
        canvases = []
      }
      const captureAssets = []
      for (const { contextId, dataUrl } of canvases) {
        if (opts?.contextId !== undefined && contextId !== opts.contextId) continue
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
        const asset = await pluginCtx.writeAsset({
          kind: 'image',
          content: Buffer.from(base64, 'base64'),
          ext: 'png',
        })
        captureAssets.push(asset)
      }
      if (captureAssets.length > 0) {
        await pluginCtx.emit({
          type: 'webgl.capture' as const,
          assets: captureAssets,
        })
      }
    },
  }
}
