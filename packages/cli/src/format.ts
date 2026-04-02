import chalk from 'chalk'

export function statusColor(status: number): string {
  if (status < 300) return chalk.green(String(status))
  if (status < 400) return chalk.yellow(String(status))
  return chalk.red(String(status))
}

export function formatStack(stack: Array<{ functionName: string; file: string; line: number }>): string {
  return stack.map(f => `  at ${f.functionName} (${chalk.cyan(f.file)}:${f.line})`).join('\n')
}
