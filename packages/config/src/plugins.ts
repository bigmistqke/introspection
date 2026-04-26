import type { IntrospectionPlugin } from '@introspection/types'
import { loadIntrospectConfig } from './load.js'
import { resolvePlugins } from './resolve.js'

export interface LoadPluginsOptions {
  cwd?: string
  configPath?: string
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  optsPlugins?: IntrospectionPlugin[]
}

export async function loadPlugins(
  opts: LoadPluginsOptions = {}
): Promise<IntrospectionPlugin[]> {
  const config = opts.optsPlugins
    ? undefined
    : await loadIntrospectConfig({ cwd: opts.cwd, configPath: opts.configPath })
  return resolvePlugins({
    optsPlugins: opts.optsPlugins,
    config,
    env: opts.env ?? process.env,
  })
}
