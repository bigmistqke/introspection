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
