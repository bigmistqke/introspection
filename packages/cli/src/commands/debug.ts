import { chromium } from '@playwright/test'
import { resolve } from 'path'
import { readFile } from 'fs/promises'
import { attach } from '@introspection/playwright'

export interface DebugOptions {
  url: string
  config?: string
  playwright?: string
  dir: string
}

export async function runDebug(opts: DebugOptions) {
  // Resolve config relative to cwd
  const configPath = resolve(process.cwd(), opts.config || './introspect.config.ts')

  // Load config (Node 24+ handles .ts natively)
  let config: { plugins: any[] }
  try {
    const configModule = await import(configPath)
    config = configModule.default
  } catch (err) {
    console.error(`Failed to load config from ${configPath}`)
    throw err
  }

  if (!config.plugins || !Array.isArray(config.plugins)) {
    throw new Error('Config must export default object with plugins array')
  }

  // Launch browser
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    // Attach introspection
    const handle = await attach(page, {
      outDir: opts.dir,
      plugins: config.plugins,
      testTitle: `debug: ${opts.url}`,
    })

    // Navigate to URL
    await page.goto(opts.url)

    // Run playwright script if provided
    if (opts.playwright) {
      let script = opts.playwright

      // If it looks like a file path, read it
      if (script.endsWith('.ts') || script.endsWith('.js')) {
        script = await readFile(script, 'utf-8')
      }

      // Execute the script with page in scope
      const fn = new Function('page', script)
      await fn(page)
    }

    // Flush and detach
    await handle.flush()
    await handle.detach()

    console.log(`\n✓ Session saved to: ${handle.sessionId}`)
    console.log(`  Query with: introspect events --session-id ${handle.sessionId}`)

    return handle.sessionId
  } finally {
    await browser.close()
  }
}
