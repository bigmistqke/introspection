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
  expect(created.source).toBe('plugin')
  expect(typeof created.data.contextId).toBe('string')
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
  const uniform = events.find((e: { type: string; data?: { name: string } }) =>
    e.type === 'webgl.uniform' && e.data?.name === 'u_time')
  expect(uniform).toBeDefined()
  expect(uniform.data.value).toBe(1.5)
  expect(uniform.data.glType).toBe('float')
  expect(uniform.source).toBe('plugin')
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
  const uniforms = events.filter((e: { type: string; data?: { name: string } }) =>
    e.type === 'webgl.uniform' && e.data?.name === 'u_time')
  expect(uniforms).toHaveLength(2)
  expect(uniforms[0].data.value).toBe(2.0)
  expect(uniforms[1].data.value).toBe(3.0)
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
  expect(draw.data.primitive).toBe('TRIANGLES')
  expect(draw.data.first).toBe(0)
  expect(draw.data.count).toBe(3)
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
  expect(uniforms[0].data.name).toBe('u_time')
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
  expect(bind.source).toBe('plugin')
  expect(bind.data.unit).toBe(0)
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
  expect(created[0].data.contextId).not.toBe(created[1].data.contextId)
})

test('capture() returns webgl-state asset with viewport and context info', async ({ page }) => {
  const { outDir, plugin, handle } = await makeSession(page)
  await setupGL(page)

  await handle.snapshot()  // triggers plugin.capture('manual')
  const events = await endSession(handle, outDir)

  const asset = events.find((e: { type: string; data?: { kind: string } }) =>
    e.type === 'asset' && e.data?.kind === 'webgl-state')
  expect(asset).toBeDefined()
  expect(asset.source).toBe('plugin')
  expect(typeof asset.data.contextId).toBe('string')
  expect(asset.data.viewport).toHaveLength(4)
})
