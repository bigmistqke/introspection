import { chromium } from '@playwright/test'
import { resolve as resolvePath, extname } from 'path'
import { readFile, stat } from 'fs/promises'
import { createReadStream } from 'fs'
import { createServer } from 'http'
import { attachRun } from '@introspection/playwright'
import { createDebug } from '@introspection/utils'
import { loadIntrospectConfig, resolvePlugins } from '@introspection/config'
import type { IntrospectionPlugin } from '@introspection/types'

export interface DebugOptions {
  url?: string
  serve?: string
  config?: string
  playwright?: string
  verbose?: boolean
  dir: string
}

export async function runDebug(opts: DebugOptions): Promise<{ runId: string; sessionId: string }> {
  const debug = createDebug('introspect:debug', opts.verbose ?? false)

  debug('Starting debug session', { url: opts.url, serve: opts.serve, verbose: opts.verbose })

  // Validate inputs
  if (!opts.url && !opts.serve) {
    throw new Error('Either url or --serve must be provided')
  }

  if (opts.url && opts.serve) {
    throw new Error('Cannot use both url and --serve')
  }

  debug('Resolving config...')

  // Resolve config via @introspection/config
  let plugins: IntrospectionPlugin[] = []
  try {
    const config = opts.config
      ? await loadIntrospectConfig({ configPath: resolvePath(process.cwd(), opts.config) })
      : await loadIntrospectConfig({ cwd: process.cwd() })
    plugins = resolvePlugins({ config, env: process.env })
  } catch (err) {
    if (opts.config) {
      console.error(`Failed to load config from ${opts.config}`)
      throw err
    }
    // Discovery path: silently fall back to no plugins.
    plugins = []
  }

  let navigationUrl: string
  const serverInfo = opts.serve ? await startLocalServer(opts.serve) : null

  if (opts.serve) {
    navigationUrl = serverInfo!.url
  } else if (opts.url) {
    navigationUrl = opts.url
  } else {
    throw new Error('Either url or --serve must be provided')
  }

  // Launch browser
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    // Attach introspection — attachRun creates <dir>/<run-id>/ and lands the
    // session at <dir>/<run-id>/<session-id>/.
    const handle = await attachRun(page, {
      dir: opts.dir,
      plugins,
      testTitle: `debug: ${navigationUrl}`,
    })

    // Navigate to URL
    await page.goto(navigationUrl)

    // Run playwright script if provided
    if (opts.playwright) {
      let script = opts.playwright

      // If it looks like a file path, read it
      if (script.endsWith('.ts') || script.endsWith('.js')) {
        script = await readFile(script, 'utf-8')
      }

      // Execute the script with page in scope (wrap in async IIFE to allow await)
      const fn = new Function('page', `return (async () => { ${script} })()`)
      await fn(page)
    }

    // Flush and detach
    await handle.flush()
    await handle.detach()

    console.log(`\n✓ Session saved to: ${handle.runId}/${handle.session.id}`)
    console.log(`  Query with: introspect events --run ${handle.runId} --session-id ${handle.session.id}`)

    return { runId: handle.runId, sessionId: handle.session.id }
  } finally {
    await browser.close()
    if (serverInfo?.server) {
      serverInfo.server.close()
    }
  }
}

interface ServerInfo {
  url: string
  server: ReturnType<typeof createServer>
}

async function startLocalServer(servePath: string): Promise<ServerInfo> {
  const basePath = resolvePath(process.cwd(), servePath)

  try {
    await stat(basePath)
  } catch {
    throw new Error(`Path not found: ${basePath}`)
  }

  return new Promise((promiseResolve, promiseReject) => {
    const server = createServer((req, res) => {
      let filePath = basePath
      const url = req.url || '/'

      // If serving a directory, default to index.html
      const isDir = !extname(basePath)
      if (isDir) {
        filePath = resolvePath(basePath, url === '/' ? 'index.html' : url.substring(1))
      } else if (url !== '/') {
        res.writeHead(404)
        res.end('Not Found')
        return
      }

      // Read and serve the file
      createReadStream(filePath)
        .on('error', () => {
          res.writeHead(404)
          res.end('Not Found')
        })
        .pipe(res)
    })

    server.listen(0, 'localhost', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0
      const url = `http://localhost:${port}`
      console.log(`Serving ${basePath} at ${url}`)
      promiseResolve({ url, server })
    })

    server.on('error', promiseReject)
  })
}
