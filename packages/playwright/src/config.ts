import { access, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { IntrospectionPlugin, IntrospectConfig, PluginSet } from '@introspection/types'

export interface ResolvePluginsArgs {
  optsPlugins?: IntrospectionPlugin[]
  config?: IntrospectConfig
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
}

function isArrayForm(plugins: PluginSet): plugins is IntrospectionPlugin[] {
  return Array.isArray(plugins)
}

export function resolvePlugins(args: ResolvePluginsArgs): IntrospectionPlugin[] {
  if (args.optsPlugins) return args.optsPlugins

  const preset = args.env.INTROSPECT_PRESET?.trim() || undefined
  const plugins = args.config?.plugins

  if (!plugins) {
    if (preset) {
      throw new Error(
        `INTROSPECT_PRESET="${preset}" is set but no introspect config was found.`
      )
    }
    return []
  }

  if (isArrayForm(plugins)) {
    if (preset) {
      throw new Error(
        `INTROSPECT_PRESET="${preset}" is set, but introspect config uses array form — presets are not defined. ` +
        `Change config to { plugins: { default: [...], ${preset}: [...] } } to use presets.`
      )
    }
    return plugins
  }

  const names = preset ? preset.split(',').map(s => s.trim()).filter(Boolean) : ['default']
  const available = Object.keys(plugins)
  const out: IntrospectionPlugin[] = []
  for (const name of names) {
    const set = plugins[name]
    if (!set) {
      throw new Error(
        `Unknown preset "${name}". Available presets: ${available.join(', ')}.`
      )
    }
    out.push(...set)
  }
  return out
}

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
