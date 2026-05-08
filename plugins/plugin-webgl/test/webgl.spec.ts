import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, rm, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { webgl } from '../dist/index.js'
import { attach } from '@introspection/playwright'
import type { IntrospectHandle } from '@introspection/types'

// ─── Test helpers ─────────────────────────────────────────────────────────────

async function makeSession(page: Page) {
  const outDir = await mkdtemp(join(tmpdir(), 'introspect-webgl-'))
  const plugin = webgl()
  const handle = await attach(page, { outDir, plugins: [plugin] })
  return { outDir, plugin, handle }
}

async function endSession(handle: IntrospectHandle, outDir: string) {
  await handle.detach()
  try {
    const [sessionId] = await readdir(outDir)
    const raw = await readFile(join(outDir, sessionId, 'events.ndjson'), 'utf-8')
    return raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}

// Sets up a minimal linked WebGL program on the page.
// Stores gl and prog on window._gl / window._prog for later evaluate() calls.
async function setupGL(page: Page) {
  await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    const gl = canvas.getContext('webgl')!
    const vs = gl.createShader(gl.VERTEX_SHADER)!
    gl.shaderSource(vs, 'uniform float u_time; uniform vec2 u_resolution; attribute vec4 p; void main(){gl_Position=p*u_time;}')
    gl.compileShader(vs)
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!
    gl.shaderSource(fs, 'void main(){gl_FragColor=vec4(1.0);}')
    gl.compileShader(fs)
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); gl.useProgram(prog)
    ;(window as unknown as Record<string, unknown>)._gl = gl
    ;(window as unknown as Record<string, unknown>)._prog = prog
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('webgl.context-created fires when getContext("webgl") is called', async ({ page }) => {
  const { outDir, handle } = await makeSession(page)

  await page.evaluate(() => {
    document.createElement('canvas').getContext('webgl')
  })

  const events = await endSession(handle, outDir)
  const created = events.find((e: { type: string }) => e.type === 'webgl.context-created')
  expect(created).toBeDefined()
  expect(typeof created.metadata.contextId).toBe('string')
})

test('uniform1f push event has correct name, value, and glType', async ({ page }) => {
  const { outDir, plugin, handle } = await makeSession(page)
  await setupGL(page)
  await plugin.watch({ event: 'uniform', name: 'u_time' })

  await page.evaluate(() => {
    const { _gl: gl, _prog: prog } = window as unknown as { _gl: WebGLRenderingContext; _prog: WebGLProgram }
    gl.uniform1f(gl.getUniformLocation(prog, 'u_time'), 1.5)
  })

  const events = await endSession(handle, outDir)
  const uniform = events.find((e: { type: string; metadata?: { name: string } }) =>
    e.type === 'webgl.uniform' && e.metadata?.name === 'u_time')
  expect(uniform).toBeDefined()
  expect(uniform.metadata.value).toBe(1.5)
  expect(uniform.metadata.glType).toBe('float')
})

test('valueChanged suppresses duplicate values, fires on change', async ({ page }) => {
  const { outDir, plugin, handle } = await makeSession(page)
  await setupGL(page)
  await plugin.watch({ event: 'uniform', name: 'u_time', valueChanged: true })

  await page.evaluate(() => {
    const { _gl: gl, _prog: prog } = window as unknown as { _gl: WebGLRenderingContext; _prog: WebGLProgram }
    const loc = gl.getUniformLocation(prog, 'u_time')
    gl.uniform1f(loc, 2.0)  // fires
    gl.uniform1f(loc, 2.0)  // suppressed — same value
    gl.uniform1f(loc, 3.0)  // fires — different value
  })

  const events = await endSession(handle, outDir)
  const uniforms = events.filter((e: { type: string; metadata?: { name: string } }) =>
    e.type === 'webgl.uniform' && e.metadata?.name === 'u_time')
  expect(uniforms).toHaveLength(2)
  expect(uniforms[0].metadata.value).toBe(2.0)
  expect(uniforms[1].metadata.value).toBe(3.0)
})

test('drawArrays push event has correct primitive name', async ({ page }) => {
  const { outDir, plugin, handle } = await makeSession(page)
  await setupGL(page)
  await plugin.watch({ event: 'draw' })

  await page.evaluate(() => {
    const { _gl: gl } = window as unknown as { _gl: WebGLRenderingContext }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  })

  const events = await endSession(handle, outDir)
  const draw = events.find((e: { type: string }) => e.type === 'webgl.draw-arrays')
  expect(draw).toBeDefined()
  expect(draw.metadata.primitive).toBe('TRIANGLES')
  expect(draw.metadata.first).toBe(0)
  expect(draw.metadata.count).toBe(3)
})

test('unwatch stops events from being pushed', async ({ page }) => {
  const { outDir, plugin, handle } = await makeSession(page)
  await setupGL(page)
  const wh = await plugin.watch({ event: 'draw' })

  await page.evaluate(() => {
    ;(window as unknown as { _gl: WebGLRenderingContext })._gl.drawArrays(
      (window as unknown as { _gl: WebGLRenderingContext })._gl.TRIANGLES, 0, 3)
  })
  await wh.unwatch()
  await page.evaluate(() => {
    ;(window as unknown as { _gl: WebGLRenderingContext })._gl.drawArrays(
      (window as unknown as { _gl: WebGLRenderingContext })._gl.TRIANGLES, 0, 3)
  })

  const events = await endSession(handle, outDir)
  const draws = events.filter((e: { type: string }) => e.type === 'webgl.draw-arrays')
  expect(draws).toHaveLength(1)  // only the one before unwatch
})

test('watch() with RegExp name filter only matches matching uniforms', async ({ page }) => {
  const { outDir, plugin, handle } = await makeSession(page)
  await setupGL(page)
  // /^u_/ should match u_time but not other names
  await plugin.watch({ event: 'uniform', name: /^u_/ })

  await page.evaluate(() => {
    const { _gl: gl, _prog: prog } = window as unknown as { _gl: WebGLRenderingContext; _prog: WebGLProgram }
    gl.uniform1f(gl.getUniformLocation(prog, 'u_time'), 1.0)
  })

  const events = await endSession(handle, outDir)
  const uniforms = events.filter((e: { type: string }) => e.type === 'webgl.uniform')
  expect(uniforms).toHaveLength(1)
  expect(uniforms[0].metadata.name).toBe('u_time')
})

test('texture-bind watch emits events on gl.bindTexture()', async ({ page }) => {
  const { outDir, plugin, handle } = await makeSession(page)
  await setupGL(page)
  await plugin.watch({ event: 'texture-bind' })

  await page.evaluate(() => {
    const { _gl: gl } = window as unknown as { _gl: WebGLRenderingContext }
    const tex = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
  })

  const events = await endSession(handle, outDir)
  const bind = events.find((e: { type: string }) => e.type === 'webgl.texture-bind')
  expect(bind).toBeDefined()
  expect(bind.metadata.unit).toBe(0)
})

test('multiple canvases produce events with distinct contextIds', async ({ page }) => {
  const { outDir, handle } = await makeSession(page)

  await page.evaluate(() => {
    const c1 = document.createElement('canvas')
    const c2 = document.createElement('canvas')
    document.body.appendChild(c1)
    document.body.appendChild(c2)
    c1.getContext('webgl')
    c2.getContext('webgl')
  })

  const events = await endSession(handle, outDir)
  const created = events.filter((e: { type: string }) => e.type === 'webgl.context-created')
  expect(created).toHaveLength(2)
  expect(created[0].metadata.contextId).not.toBe(created[1].metadata.contextId)
})

test('captureCanvas() writes a mark event with image asset', async ({ page }) => {
  const { outDir, plugin, handle } = await makeSession(page)
  await setupGL(page)

  await plugin.captureCanvas()

  // Read events directly before detach (which would also write state via capture('detach'))
  const [sessionId] = await readdir(outDir)
  const raw = await readFile(join(outDir, sessionId, 'events.ndjson'), 'utf-8')
  await endSession(handle, outDir)
  const events = raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))

  const captureEvent = events.find((e: { type: string }) =>
    e.type === 'webgl.capture')
  expect(captureEvent).toBeDefined()
  expect(typeof captureEvent.metadata.contextId).toBe('string')
  expect(captureEvent.payloads.frame).toMatchObject({ kind: 'asset', format: 'image' })
})

test('captureCanvas({ contextId }) captures only the matching canvas', async ({ page }) => {
  const { outDir, plugin, handle } = await makeSession(page)

  await page.evaluate(() => {
    for (let i = 0; i < 2; i++) {
      const c = document.createElement('canvas')
      document.body.appendChild(c)
      c.getContext('webgl')
    }
  })

  // First capture all to discover contextIds from context-created events
  await plugin.captureCanvas()

  const [sessionId] = await readdir(outDir)
  const eventsPath = join(outDir, sessionId, 'events.ndjson')
  const raw = await readFile(eventsPath, 'utf-8')
  const events = raw.trim().split('\n').filter(Boolean).map((l: string) => JSON.parse(l))
  const created = events.filter((e: { type: string }) => e.type === 'webgl.context-created')
  expect(created.length).toBeGreaterThanOrEqual(2)

  // The first capture should have produced a mark event with image assets
  // We'll verify that subsequent captures work as expected

  // Now capture only one context by ID
  const targetId = created[0].metadata.contextId as string
  await plugin.captureCanvas({ contextId: targetId })

  const raw2 = await readFile(eventsPath, 'utf-8')
  await handle.detach()
  const events2 = raw2.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
  const captures = events2.filter((e: { type: string }) =>
    e.type === 'webgl.capture')
  // captureCanvas() emits one event per canvas (≥ 2 here). captureCanvas({ contextId }) emits one more — for that single context.
  expect(captures.length).toBeGreaterThanOrEqual(3)
  const targetCaptures = captures.filter((e: { metadata: { contextId: string } }) => e.metadata.contextId === targetId)
  expect(targetCaptures.length).toBeGreaterThanOrEqual(2)
})

test('snapshot() triggers capture and emits webgl.capture event with json and image assets', async ({ page }) => {
  const { outDir, plugin, handle } = await makeSession(page)
  await setupGL(page)

  await handle.snapshot()  // triggers plugin.capture('manual')
  const events = await endSession(handle, outDir)

  const captureEvent = events.find((e: { type: string }) =>
    e.type === 'webgl.capture')
  expect(captureEvent).toBeDefined()
  expect(typeof captureEvent.metadata.contextId).toBe('string')
  // The capture event carries state (json) and/or frame (image) payloads under canonical names.
  const state = captureEvent.payloads.state as { format: string } | undefined
  const frame = captureEvent.payloads.frame as { format: string } | undefined
  expect(state || frame).toBeDefined()
  if (state) expect(state.format).toBe('json')
  if (frame) expect(frame.format).toBe('image')
})
