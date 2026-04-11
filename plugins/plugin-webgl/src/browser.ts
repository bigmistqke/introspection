// Browser-side WebGL instrumentation script.
// Bundled as IIFE and embedded into index.ts at build time.
// No imports — runs standalone in the browser.

;(() => {
  type GL = WebGLRenderingContext | WebGL2RenderingContext

  // ─── State ───────────────────────────────────────────────────────────────────

  // Plain Map (not WeakMap) — getState() / captureCanvases() need to iterate all active contexts
  const contextIds = new Map<GL, string>()
  const canvases = new Map<GL, HTMLCanvasElement | OffscreenCanvas>()
  const locationNames = new WeakMap<WebGLUniformLocation, string>()
  const textureIds = new WeakMap<WebGLTexture, number>()
  const textureCounters = new Map<GL, number>()

  interface Subscription { id: string; spec: Record<string, unknown> }
  const subscriptions = new Map<string, Subscription>()
  let subCounter = 0

  const refCounts: Record<string, number> = { uniform: 0, draw: 0, 'texture-bind': 0 }
  const lastUniformValue = new Map<string, unknown>()

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function generateUUID(): string {
    const b = new Uint8Array(16)
    crypto.getRandomValues(b)
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
  }

  function push(type: string, data: Record<string, unknown>): void {
    ;(window as unknown as { __introspect_push__: (s: string) => void }).__introspect_push__(
      JSON.stringify({ type, data })
    )
  }

  function getContextId(gl: GL): string {
    return contextIds.get(gl) ?? '<unknown>'
  }

  function getUniformName(location: WebGLUniformLocation | null): string {
    if (location === null) return '<null>'
    return locationNames.get(location) ?? `<unknown:${String(location)}>`
  }

  function glConstantName(gl: GL, value: number): string {
    const names: Record<number, string> = {
      [gl.TRIANGLES]: 'TRIANGLES', [gl.LINES]: 'LINES', [gl.POINTS]: 'POINTS',
      [gl.LINE_STRIP]: 'LINE_STRIP', [gl.LINE_LOOP]: 'LINE_LOOP',
      [gl.TRIANGLE_STRIP]: 'TRIANGLE_STRIP', [gl.TRIANGLE_FAN]: 'TRIANGLE_FAN',
    }
    return names[value] ?? String(value)
  }

  function indexTypeName(gl: GL, value: number): string {
    const names: Record<number, string> = {
      [gl.UNSIGNED_BYTE]: 'UNSIGNED_BYTE', [gl.UNSIGNED_SHORT]: 'UNSIGNED_SHORT',
      [(gl as WebGL2RenderingContext).UNSIGNED_INT ?? 5125]: 'UNSIGNED_INT',
    }
    return names[value] ?? String(value)
  }

  function matchesSpec(spec: Record<string, unknown>, contextId: string, name?: string): boolean {
    if (spec.contextId !== undefined && spec.contextId !== contextId) return false
    if (name !== undefined && spec.name !== undefined) {
      if (typeof spec.name === 'string') {
        if (spec.name !== name) return false
      } else if (spec.name && typeof spec.name === 'object') {
        const { source, flags } = spec.name as { source: string; flags: string }
        if (!new RegExp(source, flags).test(name)) return false
      }
    }
    return true
  }

  // ─── Always-active interceptors ──────────────────────────────────────────────

  function registerContext(gl: GL, canvas: HTMLCanvasElement | OffscreenCanvas): void {
    const id = generateUUID()
    contextIds.set(gl, id)
    canvases.set(gl, canvas)
    textureCounters.set(gl, 0)
    canvas.addEventListener('webglcontextlost', () => {
      push('webgl.context-lost', { contextId: id })
      for (const key of lastUniformValue.keys()) {
        if (key.startsWith(`${id}:`)) lastUniformValue.delete(key)
      }
    })
    canvas.addEventListener('webglcontextrestored', () => {
      push('webgl.context-restored', { contextId: id })
    })
    push('webgl.context-created', { contextId: id })
  }

  function forcePreserveDrawingBuffer(args: IArguments | unknown[]): unknown[] {
    const contextType = args[0] as string
    if (contextType === 'webgl' || contextType === 'webgl2') {
      const attrs = (args[1] as WebGLContextAttributes | null | undefined) ?? {}
      return [contextType, { ...attrs, preserveDrawingBuffer: true }, ...Array.from(args).slice(2)]
    }
    return Array.from(args)
  }

  const origGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof origGetContext>) {
    const ctx = origGetContext.apply(this, forcePreserveDrawingBuffer(args) as Parameters<typeof origGetContext>)
    if ((ctx instanceof WebGLRenderingContext || ctx instanceof WebGL2RenderingContext) && !contextIds.has(ctx)) {
      registerContext(ctx, this)
    }
    return ctx
  } as typeof origGetContext

  if (typeof OffscreenCanvas !== 'undefined') {
    const origOffscreen = OffscreenCanvas.prototype.getContext
    OffscreenCanvas.prototype.getContext = function (...args: Parameters<typeof origOffscreen>) {
      const ctx = origOffscreen.apply(this, forcePreserveDrawingBuffer(args) as Parameters<typeof origOffscreen>)
      if ((ctx instanceof WebGLRenderingContext || ctx instanceof WebGL2RenderingContext) && !contextIds.has(ctx)) {
        registerContext(ctx, this)
      }
      return ctx
    } as typeof origOffscreen
  }

  function patchGetUniformLocation(proto: WebGLRenderingContext): void {
    const orig = proto.getUniformLocation
    proto.getUniformLocation = function (program, name) {
      const location = orig.call(this, program, name)
      if (location !== null) locationNames.set(location, name)
      return location
    }
  }
  patchGetUniformLocation(WebGLRenderingContext.prototype)
  if (typeof WebGL2RenderingContext !== 'undefined') patchGetUniformLocation(WebGL2RenderingContext.prototype as unknown as WebGLRenderingContext)

  function patchCreateTexture(proto: WebGLRenderingContext): void {
    const orig = proto.createTexture
    proto.createTexture = function () {
      const texture = orig.call(this)
      if (texture !== null) {
        const counter = (textureCounters.get(this as GL) ?? 0) + 1
        textureCounters.set(this as GL, counter)
        textureIds.set(texture, counter)
      }
      return texture
    }
  }
  patchCreateTexture(WebGLRenderingContext.prototype)
  if (typeof WebGL2RenderingContext !== 'undefined') patchCreateTexture(WebGL2RenderingContext.prototype as unknown as WebGLRenderingContext)

  // ─── Lazy interceptors ───────────────────────────────────────────────────────

  const uniformMethods = [
    'uniform1f','uniform1fv','uniform2f','uniform2fv','uniform3f','uniform3fv','uniform4f','uniform4fv',
    'uniform1i','uniform1iv','uniform2i','uniform2iv','uniform3i','uniform3iv','uniform4i','uniform4iv',
    'uniformMatrix2fv','uniformMatrix3fv','uniformMatrix4fv',
  ] as const

  const glTypeFor: Record<string, string> = {
    uniform1f:'float', uniform1fv:'float', uniform2f:'vec2', uniform2fv:'vec2',
    uniform3f:'vec3', uniform3fv:'vec3', uniform4f:'vec4', uniform4fv:'vec4',
    uniform1i:'int', uniform1iv:'int', uniform2i:'ivec2', uniform2iv:'ivec2',
    uniform3i:'ivec3', uniform3iv:'ivec3', uniform4i:'ivec4', uniform4iv:'ivec4',
    uniformMatrix2fv:'mat2', uniformMatrix3fv:'mat3', uniformMatrix4fv:'mat4',
  }

  const lazyCleanups: Partial<Record<string, () => void>> = {}

  function installUniforms(): () => void {
    const originals: Array<[object, string, unknown]> = []
    const protos = [WebGLRenderingContext.prototype, ...(typeof WebGL2RenderingContext !== 'undefined' ? [WebGL2RenderingContext.prototype] : [])]
    for (const proto of protos) {
      for (const method of uniformMethods) {
        const orig = (proto as Record<string, unknown>)[method] as (...a: unknown[]) => void
        originals.push([proto, method, orig])
        const glType = glTypeFor[method]
        ;(proto as Record<string, unknown>)[method] = function (this: GL, location: WebGLUniformLocation | null, ...rest: unknown[]) {
          orig.call(this, location, ...rest)
          const contextId = getContextId(this)
          const name = getUniformName(location)
          const value = rest.length === 1 ? rest[0] : rest
          for (const sub of subscriptions.values()) {
            if (sub.spec.event !== 'uniform') continue
            if (!matchesSpec(sub.spec, contextId, name)) continue
            if (sub.spec.valueChanged) {
              const key = `${contextId}:${name}`
              if (JSON.stringify(lastUniformValue.get(key)) === JSON.stringify(value)) continue
              lastUniformValue.set(key, value)
            }
            push('webgl.uniform', { contextId, name, value, glType })
          }
        }
      }
    }
    return () => { for (const [proto, method, orig] of originals) (proto as Record<string, unknown>)[method] = orig }
  }

  function installDraw(): () => void {
    const cleanups: Array<() => void> = []
    const protos = [WebGLRenderingContext.prototype, ...(typeof WebGL2RenderingContext !== 'undefined' ? [WebGL2RenderingContext.prototype] : [])]
    for (const proto of protos) {
      const origArrays = proto.drawArrays
      proto.drawArrays = function (this: GL, mode, first, count) {
        origArrays.call(this, mode, first, count)
        const contextId = getContextId(this)
        const primitive = glConstantName(this, mode)
        for (const sub of subscriptions.values()) {
          if (sub.spec.event !== 'draw') continue
          if (sub.spec.contextId !== undefined && sub.spec.contextId !== contextId) continue
          if (sub.spec.primitive !== undefined && sub.spec.primitive !== primitive) continue
          push('webgl.draw-arrays', { contextId, primitive, first, count })
        }
      }
      const origElements = proto.drawElements
      proto.drawElements = function (this: GL, mode, count, type, offset) {
        origElements.call(this, mode, count, type, offset)
        const contextId = getContextId(this)
        const primitive = glConstantName(this, mode)
        for (const sub of subscriptions.values()) {
          if (sub.spec.event !== 'draw') continue
          if (sub.spec.contextId !== undefined && sub.spec.contextId !== contextId) continue
          if (sub.spec.primitive !== undefined && sub.spec.primitive !== primitive) continue
          push('webgl.draw-elements', { contextId, primitive, count, indexType: indexTypeName(this, type), offset })
        }
      }
      cleanups.push(() => { proto.drawArrays = origArrays; proto.drawElements = origElements })
    }
    return () => cleanups.forEach(c => c())
  }

  function installTextureBind(): () => void {
    const cleanups: Array<() => void> = []
    const protos = [WebGLRenderingContext.prototype, ...(typeof WebGL2RenderingContext !== 'undefined' ? [WebGL2RenderingContext.prototype] : [])]
    for (const proto of protos) {
      const orig = proto.bindTexture
      proto.bindTexture = function (this: GL, target, texture) {
        orig.call(this, target, texture)
        const contextId = getContextId(this)
        const unit = this.getParameter(this.ACTIVE_TEXTURE) - this.TEXTURE0
        const textureId = texture !== null ? (textureIds.get(texture) ?? null) : null
        const targetName = target === this.TEXTURE_2D ? 'TEXTURE_2D' : 'TEXTURE_CUBE_MAP'
        for (const sub of subscriptions.values()) {
          if (sub.spec.event !== 'texture-bind') continue
          if (sub.spec.contextId !== undefined && sub.spec.contextId !== contextId) continue
          if (sub.spec.unit !== undefined && sub.spec.unit !== unit) continue
          push('webgl.texture-bind', { contextId, unit, target: targetName, textureId })
        }
      }
      cleanups.push(() => { proto.bindTexture = orig })
    }
    return () => cleanups.forEach(c => c())
  }

  function installLazy(event: string): void {
    refCounts[event] = (refCounts[event] ?? 0) + 1
    if (refCounts[event] !== 1) return
    if (event === 'uniform') lazyCleanups[event] = installUniforms()
    else if (event === 'draw') lazyCleanups[event] = installDraw()
    else if (event === 'texture-bind') lazyCleanups[event] = installTextureBind()
  }

  function uninstallLazy(event: string): void {
    refCounts[event] = Math.max(0, (refCounts[event] ?? 0) - 1)
    if (refCounts[event] === 0) { lazyCleanups[event]?.(); delete lazyCleanups[event] }
  }

  // ─── GL state capture ─────────────────────────────────────────────────────────

  interface WebGLStateSnapshot {
    contextId: string
    uniforms: Record<string, { value: unknown; glType: string }>
    textures: Array<{ unit: number; target: string; textureId: number | null }>
    viewport: [number, number, number, number]
    blendState: { enabled: boolean; srcRgb: number; dstRgb: number; srcAlpha: number; dstAlpha: number; equation: number }
    depthState: { testEnabled: boolean; func: number; writeMask: boolean }
  }

  function getState(): WebGLStateSnapshot[] {
    return Array.from(contextIds.entries()).flatMap(([gl, id]) => {
      if (gl.isContextLost()) return []
      const textures: Array<{ unit: number; target: string; textureId: number | null }> = []
      const savedActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number
      for (let unit = 0; unit < 32; unit++) {
        gl.activeTexture(gl.TEXTURE0 + unit)
        const bound2d = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null
        const boundCube = gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP) as WebGLTexture | null
        if (bound2d) textures.push({ unit, target: 'TEXTURE_2D', textureId: textureIds.get(bound2d) ?? null })
        if (boundCube) textures.push({ unit, target: 'TEXTURE_CUBE_MAP', textureId: textureIds.get(boundCube) ?? null })
      }
      gl.activeTexture(savedActiveTexture)  // restore — do not corrupt app state

      return [{
        contextId: id,
        uniforms: {},  // WebGL has no API to read back uniform values
        textures,
        viewport: Array.from(gl.getParameter(gl.VIEWPORT)) as [number, number, number, number],
        blendState: {
          enabled: gl.isEnabled(gl.BLEND),
          srcRgb: gl.getParameter(gl.BLEND_SRC_RGB) as number,
          dstRgb: gl.getParameter(gl.BLEND_DST_RGB) as number,
          srcAlpha: gl.getParameter(gl.BLEND_SRC_ALPHA) as number,
          dstAlpha: gl.getParameter(gl.BLEND_DST_ALPHA) as number,
          equation: gl.getParameter(gl.BLEND_EQUATION_RGB) as number,
        },
        depthState: {
          testEnabled: gl.isEnabled(gl.DEPTH_TEST),
          func: gl.getParameter(gl.DEPTH_FUNC) as number,
          writeMask: gl.getParameter(gl.DEPTH_WRITEMASK) as boolean,
        },
      }]
    })
  }

  // ─── Canvas capture ───────────────────────────────────────────────────────────

  async function captureCanvases(): Promise<Array<{ contextId: string; dataUrl: string }>> {
    const results: Array<{ contextId: string; dataUrl: string }> = []
    for (const [gl, id] of contextIds.entries()) {
      if (gl.isContextLost()) continue
      const canvas = canvases.get(gl)
      if (!canvas) continue
      try {
        if (canvas instanceof HTMLCanvasElement) {
          results.push({ contextId: id, dataUrl: canvas.toDataURL('image/png') })
        } else if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
          const blob = await canvas.convertToBlob({ type: 'image/png' })
          const buf = await blob.arrayBuffer()
          const bytes = new Uint8Array(buf)
          let binary = ''
          for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
          results.push({ contextId: id, dataUrl: 'data:image/png;base64,' + btoa(binary) })
        }
      } catch { /* non-fatal — skip this context */ }
    }
    return results
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  window.__introspect_plugins__ = window.__introspect_plugins__ || {}
  ;(window.__introspect_plugins__ as Record<string, unknown>).webgl = {
    watch(spec: Record<string, unknown>): string {
      const id = String(subCounter++)
      installLazy(spec.event as string)
      subscriptions.set(id, { id, spec })
      return id
    },
    unwatch(id: string): void {
      const sub = subscriptions.get(id)
      if (!sub) return
      subscriptions.delete(id)
      uninstallLazy(sub.spec.event as string)
    },
    getState,
    captureCanvases,
  }
})()
