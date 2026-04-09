import type { SessionMeta } from '@introspection/types'

export function formatPlugins(session: SessionMeta): string {
  if (!session.plugins?.length) {
    return '(No plugin metadata recorded in this session)'
  }

  const sections: string[] = []

  for (const plugin of session.plugins) {
    const lines: string[] = []
    const header = plugin.description
      ? `${plugin.name} — ${plugin.description}`
      : plugin.name
    lines.push(header)

    if (plugin.events) {
      lines.push('  Events:')
      const maxLen = Math.max(...Object.keys(plugin.events).map(k => k.length))
      for (const [type, description] of Object.entries(plugin.events)) {
        lines.push(`    ${type.padEnd(maxLen + 2)}${description}`)
      }
    }

    if (plugin.options) {
      lines.push('  Options:')
      for (const [key, { description, value }] of Object.entries(plugin.options)) {
        lines.push(`    ${key} = ${JSON.stringify(value)}  ${description}`)
      }
    }

    sections.push(lines.join('\n'))
  }

  return sections.join('\n\n')
}
