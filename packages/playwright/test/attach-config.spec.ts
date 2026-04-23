import { test, expect, chromium } from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { attach } from '../src/attach.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function readMeta(sessionRoot: string): Record<string, unknown> {
  const entries = readdirSync(sessionRoot).filter(entry => !entry.startsWith('.'))
  const sessionDir = join(sessionRoot, entries[0])
  return JSON.parse(readFileSync(join(sessionDir, 'meta.json'), 'utf-8'))
}

test('attach loads config from cwd and uses default preset when env unset', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'introspect-attach-cfg-'))
  const cwd = resolve(__dirname, 'fixtures/config-presets')
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    const handle = await attach(page, { outDir, cwd })
    await handle.detach({ status: 'passed' })
    const meta = readMeta(outDir)
    const names = ((meta.plugins as Array<{ name: string }>) ?? []).map(p => p.name)
    expect(names).toEqual(['fixture-default-plugin'])
  } finally {
    await browser.close()
    rmSync(outDir, { recursive: true, force: true })
  }
})

test('attach selects preset via INTROSPECT_PRESET env var', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'introspect-attach-cfg-'))
  const cwd = resolve(__dirname, 'fixtures/config-presets')
  const prev = process.env.INTROSPECT_PRESET
  process.env.INTROSPECT_PRESET = 'network'
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    const handle = await attach(page, { outDir, cwd })
    await handle.detach({ status: 'passed' })
    const meta = readMeta(outDir)
    const names = ((meta.plugins as Array<{ name: string }>) ?? []).map(p => p.name)
    expect(names).toEqual(['fixture-network-plugin'])
  } finally {
    if (prev === undefined) delete process.env.INTROSPECT_PRESET
    else process.env.INTROSPECT_PRESET = prev
    await browser.close()
    rmSync(outDir, { recursive: true, force: true })
  }
})

test('explicit opts.plugins overrides config entirely', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'introspect-attach-cfg-'))
  const cwd = resolve(__dirname, 'fixtures/config-presets')
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    const handle = await attach(page, {
      outDir,
      cwd,
      plugins: [{ name: 'explicit-override', install: async () => {} } as any],
    })
    await handle.detach({ status: 'passed' })
    const meta = readMeta(outDir)
    const names = ((meta.plugins as Array<{ name: string }>) ?? []).map(p => p.name)
    expect(names).toEqual(['explicit-override'])
  } finally {
    await browser.close()
    rmSync(outDir, { recursive: true, force: true })
  }
})
