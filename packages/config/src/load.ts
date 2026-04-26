import { access, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { IntrospectConfig } from '@introspection/types'

const CONFIG_FILENAMES = [
  'introspect.config.ts',
  'introspect.config.mts',
  'introspect.config.js',
  'introspect.config.mjs',
]

export interface LoadConfigOptions {
  cwd?: string
  configPath?: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function findConfigFile(startDir: string): Promise<string | undefined> {
  let dir = resolve(startDir)
  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = resolve(dir, name)
      if (await exists(candidate)) return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

export async function loadIntrospectConfig(
  opts: LoadConfigOptions = {}
): Promise<IntrospectConfig | undefined> {
  let path: string | undefined
  if (opts.configPath) {
    await stat(opts.configPath)
    path = opts.configPath
  } else {
    path = await findConfigFile(opts.cwd ?? process.cwd())
    if (!path) return undefined
  }
  const mod = await import(pathToFileURL(path).href)
  const config = (mod.default ?? mod) as IntrospectConfig
  return config
}
