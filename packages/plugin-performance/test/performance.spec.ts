import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, rm, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { performance } from '../dist/index.js'
import { attach } from '@introspection/playwright'
import type { IntrospectHandle } from '@introspection/types'

async function makeSession(page: Page, options?: Parameters<typeof performance>[0]) {
  const outDir = await mkdtemp(join(tmpdir(), 'introspect-perf-'))
  const plugin = performance(options)
  const handle = await attach(page, { outDir, plugins: [plugin] })
  return { outDir, handle }
}

async function endSession(handle: IntrospectHandle, outDir: string) {
  await handle.detach()
  try {
    const [sessionId] = await readdir(outDir)
    const raw = await readFile(join(outDir, sessionId, 'events.ndjson'), 'utf-8')
    return raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}

test('emits perf.cwv event with metric lcp on navigation', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" width="500" height="500" /></body></html>',
    })
  )

  const { outDir, handle } = await makeSession(page)
  await handle.page.goto('http://localhost:9999/')
  await new Promise(resolve => setTimeout(resolve, 500))

  const events = await endSession(handle, outDir)
  const lcpEvents = events.filter(
    (event: { type: string; data: { metric: string } }) =>
      event.type === 'perf.cwv' && event.data.metric === 'lcp'
  )

  expect(lcpEvents.length).toBeGreaterThanOrEqual(1)
  const lcp = lcpEvents[0]
  expect(lcp.source).toBe('plugin')
  expect(typeof lcp.data.value).toBe('number')
  expect(typeof lcp.data.startTime).toBe('number')
})

test('emits perf.layout-shift events when layout shifts occur', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html><body>
        <div id="target" style="position:relative;top:0;width:100px;height:100px;background:red"></div>
        <script>
          setTimeout(() => {
            document.getElementById('target').style.top = '200px';
          }, 100);
        </script>
      </body></html>`,
    })
  )

  const { outDir, handle } = await makeSession(page)
  await handle.page.goto('http://localhost:9999/')
  await new Promise(resolve => setTimeout(resolve, 500))

  const events = await endSession(handle, outDir)
  const shiftEvents = events.filter((event: { type: string }) => event.type === 'perf.layout-shift')

  expect(shiftEvents.length).toBeGreaterThanOrEqual(1)
  const shift = shiftEvents[0]
  expect(shift.source).toBe('plugin')
  expect(typeof shift.data.score).toBe('number')
  expect(typeof shift.data.hadRecentInput).toBe('boolean')
})

test('emits perf.cwv event with metric inp on user interaction', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><button id="btn" onclick="let x=0;for(let i=0;i<1e6;i++)x+=i;">Click</button></body></html>',
    })
  )

  const { outDir, handle } = await makeSession(page)
  await handle.page.goto('http://localhost:9999/')
  await handle.page.click('#btn')
  await new Promise(resolve => setTimeout(resolve, 500))

  const events = await endSession(handle, outDir)
  const inpEvents = events.filter(
    (event: { type: string; data: { metric: string } }) =>
      event.type === 'perf.cwv' && event.data.metric === 'inp'
  )

  expect(inpEvents.length).toBeGreaterThanOrEqual(1)
  expect(typeof inpEvents[0].data.value).toBe('number')
  expect(typeof inpEvents[0].data.startTime).toBe('number')
})

test('emits perf.paint events for FP and FCP on navigation', async ({ page }) => {
  await page.route('**/*', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><h1>Hello</h1></body></html>',
    })
  )

  const { outDir, handle } = await makeSession(page)
  await handle.page.goto('http://localhost:9999/')
  await new Promise(resolve => setTimeout(resolve, 500))

  const events = await endSession(handle, outDir)
  const paintEvents = events.filter((event: { type: string }) => event.type === 'perf.paint')

  expect(paintEvents.length).toBeGreaterThanOrEqual(1)
  const fcp = paintEvents.find((event: { data: { name: string } }) => event.data.name === 'first-contentful-paint')
  expect(fcp).toBeDefined()
  expect(fcp.source).toBe('plugin')
  expect(typeof fcp.data.startTime).toBe('number')
})
