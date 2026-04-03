import type { IntrospectionPlugin, BrowserAgent } from '@introspection/types'

export interface WebGLPlugin extends IntrospectionPlugin {
  track<T extends WebGLRenderingContext | WebGL2RenderingContext>(gl: T): T
  frame(): void
  stateSnapshot(): void
}

type AnyGL = WebGLRenderingContext | WebGL2RenderingContext

interface ShaderInfo { type: number; source: string; compiled: boolean; log: string }
interface ProgramInfo {
  linked: boolean; log: string
  uniforms: Array<{ name: string; type: string; value: unknown }>
  attributes: Array<{ name: string; location: number }>
}
interface TextureInfo { width: number; height: number; format: number; internalFormat: number }
interface FrameStats { drawCalls: number; glErrors: string[]; primitiveCount: number }

const GL_ERRORS: Record<number, string> = {
  0x0500: 'INVALID_ENUM',
  0x0501: 'INVALID_VALUE',
  0x0502: 'INVALID_OPERATION',
  0x0505: 'OUT_OF_MEMORY',
  0x0506: 'INVALID_FRAMEBUFFER_OPERATION',
}

function canvasId(canvas: HTMLCanvasElement | OffscreenCanvas | null | undefined, index: number): string {
  if (canvas && 'id' in canvas && (canvas as HTMLCanvasElement).id) return (canvas as HTMLCanvasElement).id
  return `canvas[${index}]`
}

export function createWebGLPlugin(): WebGLPlugin {
  let agent: BrowserAgent | null = null

  const shaders = new Map<object, ShaderInfo>()
  const programs = new Map<object, ProgramInfo>()
  const textures = new Map<object, TextureInfo>()
  const contexts = new Map<AnyGL, HTMLCanvasElement | OffscreenCanvas | null>()

  // Maps GL target enum → currently bound texture object (updated by bindTexture interception)
  const currentTexture = new Map<number, object>()

  let acc: FrameStats = { drawCalls: 0, glErrors: [], primitiveCount: 0 }
  let totalFrames = 0
  let lastFrame: FrameStats | null = null

  function emit(type: `plugin.${string}`, data: Record<string, unknown>) {
    agent?.emit({ type, data })
  }

  function ctxIndex(gl: AnyGL) { return [...contexts.keys()].indexOf(gl) }

  function handleDraw(gl: AnyGL, count: number) {
    acc.drawCalls++
    acc.primitiveCount += count
    const code = (gl as WebGLRenderingContext).getError()
    if (code !== 0) {
      const name = GL_ERRORS[code] ?? `0x${code.toString(16)}`
      const canvas = contexts.get(gl) ?? (gl as WebGLRenderingContext).canvas ?? null
      emit('plugin.webgl.error', { error: name, canvas: canvasId(canvas as HTMLCanvasElement | null, ctxIndex(gl)) })
      acc.glErrors.push(name)
    }
  }

  function wrap<T extends AnyGL>(gl: T): T {
    return new Proxy(gl, {
      get(target, prop, receiver) {
        const val = Reflect.get(target, prop, receiver)
        if (typeof val !== 'function') return val

        if (prop === 'shaderSource') return (shader: object, source: string) => {
          if (!shaders.has(shader)) shaders.set(shader, { type: 0, source: '', compiled: false, log: '' })
          shaders.get(shader)!.source = source
          return val.call(target, shader, source)
        }

        if (prop === 'compileShader') return (shader: object) => {
          const r = val.call(target, shader)
          if (!shaders.has(shader)) shaders.set(shader, { type: 0, source: '', compiled: false, log: '' })
          const info = shaders.get(shader)!
          info.compiled = !!(gl as WebGLRenderingContext).getShaderParameter(shader as WebGLShader, (gl as WebGLRenderingContext).COMPILE_STATUS)
          info.log = (gl as WebGLRenderingContext).getShaderInfoLog(shader as WebGLShader) ?? ''
          return r
        }

        if (prop === 'linkProgram') return (program: object) => {
          const r = val.call(target, program)
          const g = gl as WebGLRenderingContext
          const uniformCount = g.getProgramParameter(program as WebGLProgram, g.ACTIVE_UNIFORMS) as number
          const attrCount = g.getProgramParameter(program as WebGLProgram, g.ACTIVE_ATTRIBUTES) as number
          const uniforms: ProgramInfo['uniforms'] = []
          const attributes: ProgramInfo['attributes'] = []
          for (let i = 0; i < uniformCount; i++) {
            const u = g.getActiveUniform(program as WebGLProgram, i)
            if (u) uniforms.push({ name: u.name, type: String(u.type), value: null })
          }
          for (let i = 0; i < attrCount; i++) {
            const a = g.getActiveAttrib(program as WebGLProgram, i)
            if (a) attributes.push({ name: a.name, location: i })
          }
          programs.set(program, {
            linked: !!g.getProgramParameter(program as WebGLProgram, g.LINK_STATUS),
            log: g.getProgramInfoLog(program as WebGLProgram) ?? '',
            uniforms, attributes,
          })
          return r
        }

        if (prop === 'bindTexture') return (texTarget: number, texture: object | null) => {
          if (texture) currentTexture.set(texTarget, texture)
          else currentTexture.delete(texTarget)
          return val.call(target, texTarget, texture)
        }

        if (prop === 'texImage2D') return (...args: unknown[]) => {
          const texTarget = args[0] as number
          const texture = currentTexture.get(texTarget)
          if (texture) {
            // texImage2D(target, level, internalFormat, width, height, border, format, type, pixels) — 9 args
            // texImage2D(target, level, internalFormat, format, type, source) — 6 args
            const internalFormat = args[2] as number
            const format = args.length >= 9 ? args[6] as number : args[3] as number
            const width = args.length >= 9 ? args[3] as number : 0
            const height = args.length >= 9 ? args[4] as number : 0
            textures.set(texture, { width, height, format, internalFormat })
          }
          return (val as (...a: unknown[]) => unknown).apply(target, args)
        }

        if (prop === 'texImage3D') return (...args: unknown[]) => {
          // texImage3D(target, level, internalFormat, width, height, depth, border, format, type, pixels)
          const texTarget = args[0] as number
          const texture = currentTexture.get(texTarget)
          if (texture) {
            const internalFormat = args[2] as number
            const format = args[7] as number
            const width = args[3] as number
            const height = args[4] as number
            textures.set(texture, { width, height, format, internalFormat })
          }
          return (val as (...a: unknown[]) => unknown).apply(target, args)
        }

        if (prop === 'drawArrays' || prop === 'drawArraysInstanced') {
          return (...args: unknown[]) => {
            const r = (val as (...a: unknown[]) => unknown).apply(target, args)
            // drawArrays(mode, first, count, ...) — count is args[2]
            handleDraw(gl, args[2] as number)
            return r
          }
        }

        if (prop === 'drawElements' || prop === 'drawElementsInstanced') {
          return (...args: unknown[]) => {
            const r = (val as (...a: unknown[]) => unknown).apply(target, args)
            // drawElements(mode, count, type, offset, ...) — count is args[1]
            handleDraw(gl, args[1] as number)
            return r
          }
        }

        return val.bind(target)
      },
    })
  }

  const plugin: WebGLPlugin = {
    name: 'webgl',

    browser: {
      setup(a) { agent = a },
      snapshot() {
        return { contextCount: contexts.size, totalFrames, lastFrame }
      },
    },

    track<T extends AnyGL>(gl: T): T {
      const canvas = (gl as WebGLRenderingContext).canvas ?? null
      contexts.set(gl, canvas as HTMLCanvasElement | OffscreenCanvas | null)
      if (canvas && 'addEventListener' in canvas) {
        const idx = ctxIndex(gl)
        ;(canvas as HTMLCanvasElement).addEventListener('webglcontextlost', () => {
          emit('plugin.webgl.contextlost', { canvas: canvasId(canvas as HTMLCanvasElement, idx) })
          plugin.stateSnapshot()
        })
      }
      return wrap(gl)
    },

    frame() {
      const stats = { ...acc, contextCount: contexts.size }
      lastFrame = { drawCalls: acc.drawCalls, glErrors: acc.glErrors, primitiveCount: acc.primitiveCount }
      totalFrames++
      acc = { drawCalls: 0, glErrors: [], primitiveCount: 0 }
      emit('plugin.webgl.frame', stats)
    },

    stateSnapshot() {
      emit('plugin.webgl.stateSnapshot', {
        shaders: [...shaders.values()].map(s => ({
          type: s.type === 0x8B31 ? 'VERTEX_SHADER' : 'FRAGMENT_SHADER',
          source: s.source, compiled: s.compiled, log: s.log,
        })),
        programs: [...programs.values()],
        textures: [...textures.values()].map(t => ({
          width: t.width, height: t.height,
          format: String(t.format), internalFormat: String(t.internalFormat),
        })),
        frames: { total: totalFrames, last: lastFrame },
      })
    },
  }

  return plugin
}
