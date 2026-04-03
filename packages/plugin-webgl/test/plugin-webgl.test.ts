import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWebGLPlugin } from '../src/index.js'
import type { BrowserAgent } from '@introspection/types'

function mockGl() {
  return {
    drawArrays: vi.fn(),
    drawElements: vi.fn(),
    drawArraysInstanced: vi.fn(),
    drawElementsInstanced: vi.fn(),
    getError: vi.fn().mockReturnValue(0),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn().mockReturnValue(true),
    getShaderInfoLog: vi.fn().mockReturnValue(''),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn().mockImplementation((_p: unknown, param: number) => {
      if (param === 0x8B82) return true   // LINK_STATUS
      if (param === 0x8B86) return 0      // ACTIVE_UNIFORMS
      if (param === 0x8B89) return 0      // ACTIVE_ATTRIBUTES
      return null
    }),
    getProgramInfoLog: vi.fn().mockReturnValue(''),
    getActiveUniform: vi.fn(),
    getActiveAttrib: vi.fn(),
    texImage2D: vi.fn(),
    texImage3D: vi.fn(),
    bindTexture: vi.fn(),
    canvas: { id: 'my-canvas', addEventListener: vi.fn() } as unknown as HTMLCanvasElement,
    COMPILE_STATUS: 0x8B81,
    LINK_STATUS: 0x8B82,
    ACTIVE_UNIFORMS: 0x8B86,
    ACTIVE_ATTRIBUTES: 0x8B89,
  }
}

describe('createWebGLPlugin()', () => {
  let agent: BrowserAgent
  let emitMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    emitMock = vi.fn()
    agent = { emit: emitMock }
  })

  it('has name "webgl"', () => {
    expect(createWebGLPlugin().name).toBe('webgl')
  })

  it('track() calls through to original on drawArrays', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    const proxied = plugin.track(gl as never)
    proxied.drawArrays(4, 0, 3)
    expect(gl.drawArrays).toHaveBeenCalledWith(4, 0, 3)
  })

  it('drawArrays increments drawCalls and primitiveCount', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    const proxied = plugin.track(gl as never)
    proxied.drawArrays(4, 0, 6)
    proxied.drawArrays(4, 0, 3)
    plugin.frame()
    const call = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.frame')!
    expect(call[0].data.drawCalls).toBe(2)
    expect(call[0].data.primitiveCount).toBe(9)
  })

  it('frame() resets accumulator after emitting', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    const proxied = plugin.track(gl as never)
    proxied.drawArrays(4, 0, 3)
    plugin.frame()
    emitMock.mockClear()
    plugin.frame()
    const call = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.frame')!
    expect(call[0].data.drawCalls).toBe(0)
    expect(call[0].data.primitiveCount).toBe(0)
  })

  it('frame() emits contextCount', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    plugin.track(mockGl() as never)
    plugin.track(mockGl() as never)
    plugin.frame()
    const call = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.frame')!
    expect(call[0].data.contextCount).toBe(2)
  })

  it('getError non-zero emits plugin.webgl.error immediately', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    gl.getError.mockReturnValueOnce(0x0500)
    const proxied = plugin.track(gl as never)
    proxied.drawArrays(4, 0, 3)
    const errorCall = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.error')
    expect(errorCall).toBeDefined()
    expect(errorCall![0].data.error).toBe('INVALID_ENUM')
    expect(errorCall![0].data.canvas).toBe('my-canvas')
  })

  it('GL error is also accumulated into next frame glErrors', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    gl.getError.mockReturnValueOnce(0x0502)
    const proxied = plugin.track(gl as never)
    proxied.drawArrays(4, 0, 3)
    plugin.frame()
    const frameCall = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.frame')!
    expect(frameCall[0].data.glErrors).toContain('INVALID_OPERATION')
  })

  it('canvas with no id uses canvas[N] format', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    ;(gl.canvas as unknown as { id: string }).id = ''
    gl.getError.mockReturnValueOnce(0x0500)
    const proxied = plugin.track(gl as never)
    proxied.drawArrays(4, 0, 3)
    const errorCall = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.error')!
    expect(errorCall[0].data.canvas).toBe('canvas[0]')
  })

  it('browser.snapshot() returns lightweight summary', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    plugin.track(mockGl() as never)
    const snap = plugin.browser!.snapshot()
    expect(snap).toEqual({ contextCount: 1, totalFrames: 0, lastFrame: null })
  })

  it('drawElements also accumulates drawCalls and primitiveCount', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    const proxied = plugin.track(gl as never)
    proxied.drawElements(4, 6, 0x1405, 0)
    plugin.frame()
    const call = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.frame')!
    expect(call[0].data.drawCalls).toBe(1)
    expect(call[0].data.primitiveCount).toBe(6)
  })

  it('browser.snapshot().lastFrame is populated after frame()', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    const proxied = plugin.track(gl as never)
    proxied.drawArrays(4, 0, 9)
    plugin.frame()
    const snap = plugin.browser!.snapshot()
    expect(snap.lastFrame).toEqual({ drawCalls: 1, glErrors: [], primitiveCount: 9 })
    expect(snap.totalFrames).toBe(1)
  })

  it('calls before setup() are silently dropped', () => {
    const plugin = createWebGLPlugin()
    expect(() => plugin.frame()).not.toThrow()
    expect(() => plugin.stateSnapshot()).not.toThrow()
  })

  it('compileShader failure is recorded in shader registry', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    gl.getShaderParameter.mockReturnValue(false)
    gl.getShaderInfoLog.mockReturnValue('syntax error')
    const proxied = plugin.track(gl as never)
    const shader = {}
    proxied.shaderSource(shader as never, 'void main() {}')
    proxied.compileShader(shader as never)
    plugin.stateSnapshot()
    const call = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.stateSnapshot')!
    expect(call[0].data.shaders[0].compiled).toBe(false)
    expect(call[0].data.shaders[0].log).toBe('syntax error')
    expect(call[0].data.shaders[0].source).toBe('void main() {}')
  })

  it('stateSnapshot() emits frames.total and frames.last', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    const proxied = plugin.track(gl as never)
    proxied.drawArrays(4, 0, 3)
    plugin.frame()
    plugin.stateSnapshot()
    const call = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.stateSnapshot')!
    expect(call[0].data.frames.total).toBe(1)
    expect(call[0].data.frames.last.drawCalls).toBe(1)
  })

  it('bindTexture + texImage2D records texture info keyed by texture object', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    const proxied = plugin.track(gl as never)
    const tex = {}
    proxied.bindTexture(0xDE1 /* TEXTURE_2D */, tex as never)
    proxied.texImage2D(0xDE1, 0, 0x1908 /* RGBA */, 64, 32, 0, 0x1908, 0x1401, null)
    plugin.stateSnapshot()
    const call = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.stateSnapshot')!
    expect(call[0].data.textures[0].width).toBe(64)
    expect(call[0].data.textures[0].height).toBe(32)
  })

  it('webglcontextlost emits plugin.webgl.contextlost and triggers stateSnapshot', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    let lostHandler: (() => void) | undefined
    ;(gl.canvas as unknown as { addEventListener: (e: string, fn: () => void) => void }).addEventListener = (_e: string, fn: () => void) => { lostHandler = fn }
    plugin.track(gl as never)
    lostHandler!()
    const lostCall = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.contextlost')
    const snapCall = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.stateSnapshot')
    expect(lostCall).toBeDefined()
    expect(snapCall).toBeDefined()
  })

  it('stateSnapshot() reports correct shader type (VERTEX vs FRAGMENT)', () => {
    const plugin = createWebGLPlugin()
    plugin.browser!.setup(agent)
    const gl = mockGl()
    // Mock SHADER_TYPE: return VERTEX_SHADER (0x8B31) for this shader
    gl.getShaderParameter.mockImplementation((_shader: unknown, param: number) => {
      if (param === 0x8B81 /* COMPILE_STATUS */) return true
      if (param === 0x8B4F /* SHADER_TYPE */) return 0x8B31 /* VERTEX_SHADER */
      return null
    })
    const proxied = plugin.track(gl as never)
    const shader = {}
    proxied.shaderSource(shader as never, 'void main() {}')
    proxied.compileShader(shader as never)
    plugin.stateSnapshot()
    const call = emitMock.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === 'plugin.webgl.stateSnapshot')!
    expect(call[0].data.shaders[0].type).toBe('VERTEX_SHADER')
  })
})
