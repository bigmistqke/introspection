import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

// Helpers defined here — expanded in later tasks
async function getEvents(outDir: string) {
  const [sessionId] = await readdir(outDir)
  return (await readFile(join(outDir, sessionId, 'events.ndjson'), 'utf-8'))
    .trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
}

test('webgl.context-created fires when getContext("webgl") is called', async ({ page }) => {
  // Dynamic import — will fail until index.ts exists
  const { webgl } = await import('../src/index.js')
  const { attach } = await import('@introspection/playwright')

  const outDir = await mkdtemp(join(tmpdir(), 'introspect-webgl-'))
  try {
    const plugin = webgl()
    const handle = await attach(page, { outDir, plugins: [plugin] })

    await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      document.body.appendChild(canvas)
      canvas.getContext('webgl')
    })

    await handle.detach()
    const events = await getEvents(outDir)
    const created = events.find((e: { type: string }) => e.type === 'webgl.context-created')
    expect(created).toBeDefined()
    expect(created.source).toBe('plugin')
    expect(created.data.contextId).toBeDefined()
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
