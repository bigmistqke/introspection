// Loaded as raw text by esbuild (tsup.node.config.ts sets loader['.iife.js'] = 'text').
// The import path is relative to src/ and resolved at build time — not a runtime path.
import BROWSER_SCRIPT from '../dist/browser.iife.js'
import type { IntrospectionPlugin, PluginContext, WatchHandle, CaptureResult } from '@introspection/types'

declare global {
  interface Window {
    __introspect_plugins__?: Record<string, unknown>
  }
}

export type NameFilter = string | RegExp

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

export function webgl(): WebGLPlugin {
  let ctx: PluginContext | null = null

  return {
    name: 'webgl',
    script: BROWSER_SCRIPT,

    async install(pluginCtx: PluginContext): Promise<void> {
      ctx = pluginCtx
    },

    async watch(opts: WebGLWatchOpts): Promise<WatchHandle> {
      if (!ctx) throw new Error('webgl plugin: watch() called before install()')
      let spec: Record<string, unknown>
      if (opts.event === 'uniform') {
        spec = {
          event: 'uniform',
          ...(opts.contextId !== undefined && { contextId: opts.contextId }),
          ...(opts.name !== undefined && { name: serialiseName(opts.name) }),
          ...(opts.valueChanged !== undefined && { valueChanged: opts.valueChanged }),
        }
      } else if (opts.event === 'draw') {
        spec = {
          event: 'draw',
          ...(opts.contextId !== undefined && { contextId: opts.contextId }),
          ...(opts.primitive !== undefined && { primitive: opts.primitive }),
        }
      } else {
        spec = {
          event: 'texture-bind',
          ...(opts.contextId !== undefined && { contextId: opts.contextId }),
          ...((opts as TextureBindWatchOpts).unit !== undefined && { unit: (opts as TextureBindWatchOpts).unit }),
        }
      }
      return ctx.addSubscription('webgl', spec)
    },

    async captureCanvas(opts?: { contextId?: string }): Promise<void> {
      if (!ctx) throw new Error('webgl plugin: captureCanvas() called before install()')
      const canvases = await ctx.page.evaluate(async () => {
        const p = (window.__introspect_plugins__ as {
          webgl?: { captureCanvases?(): Promise<Array<{ contextId: string; dataUrl: string }>> }
        } | undefined)?.webgl
        return p?.captureCanvases?.() ?? []
      })
      const ts = ctx.timestamp()
      for (const { contextId, dataUrl } of canvases) {
        if (opts?.contextId !== undefined && contextId !== opts.contextId) continue
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
        await ctx.writeAsset({
          kind: 'webgl-canvas',
          content: Buffer.from(base64, 'base64'),
          ext: 'png',
          metadata: { timestamp: ts, contextId },
        })
      }
    },

    async capture(_trigger: 'js.error' | 'manual' | 'detach', ts: number): Promise<CaptureResult[]> {
      if (!ctx) return []

      const snapshots = await ctx.page.evaluate(() => {
        return (window.__introspect_plugins__ as { webgl?: { getState?(): unknown[] } } | undefined)
          ?.webgl?.getState?.() ?? []
      }) as WebGLStateSnapshot[]

      const canvases = await ctx.page.evaluate(async () => {
        const p = (window.__introspect_plugins__ as {
          webgl?: { captureCanvases?(): Promise<Array<{ contextId: string; dataUrl: string }>> }
        } | undefined)?.webgl
        return p?.captureCanvases?.() ?? []
      })

      const results: CaptureResult[] = snapshots.map(snapshot => ({
        kind: 'webgl-state',
        content: JSON.stringify(snapshot),
        summary: {
          contextId: snapshot.contextId,
          uniformCount: Object.keys(snapshot.uniforms).length,
          boundTextureCount: snapshot.textures.length,
          viewport: snapshot.viewport,
          timestamp: ts,
        },
      }))

      for (const { contextId, dataUrl } of canvases) {
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
        results.push({
          kind: 'webgl-canvas',
          content: Buffer.from(base64, 'base64'),
          ext: 'png',
          summary: { contextId, timestamp: ts },
        })
      }

      return results
    },
  }
}
