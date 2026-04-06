import chalk from 'chalk'
import type { Snapshot } from '@introspection/types'

export function selectSnapshot(snapshots: Snapshot[], filter?: string): Snapshot | undefined {
  if (!snapshots.length) return undefined
  if (!filter) return snapshots.at(-1)
  const fn = new Function('snapshot', `return (${filter})`) as (snapshot: Snapshot) => boolean
  return snapshots.filter(fn).at(-1)
}

export function statusColor(status: number): string {
  if (status < 300) return chalk.green(String(status))
  if (status < 400) return chalk.yellow(String(status))
  return chalk.red(String(status))
}

export function formatStack(stack: Array<{ functionName: string; file: string; line: number }>): string {
  return stack.map(f => `  at ${f.functionName} (${chalk.cyan(f.file)}:${f.line})`).join('\n')
}
