import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import type { IntrospectionPlugin, PluginContext, WatchHandle, CaptureResult } from '@introspection/types'

declare global {
  interface Window {
    __introspect_plugins__?: Record<string, unknown>
  }
}

function loadBrowserScript(): string {
  // Works from dist/ (published) and src/ (during development/tests, after pnpm build)
  const base = dirname(fileURLToPath(import.meta.url))
  for (const rel of ['./browser.iife.js', '../dist/browser.iife.js']) {
    try { return readFileSync(join(base, rel), 'utf-8') } catch { /* try next */ }
  }
  throw new Error('@introspection/plugin-webgl: browser bundle not found — run pnpm build first')
}

const BROWSER_SCRIPT = loadBrowserScript()

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

    async capture(_trigger: 'js.error' | 'manual' | 'detach', ts: number): Promise<CaptureResult[]> {
      if (!ctx) return []
      const snapshots = await ctx.page.evaluate(() => {
        return (window.__introspect_plugins__ as { webgl?: { getState?(): unknown[] } })?.webgl?.getState?.() ?? []
      }) as WebGLStateSnapshot[]
      return snapshots.map(snapshot => ({
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
    },
  }
}
