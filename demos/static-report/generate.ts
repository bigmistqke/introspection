import { createSessionReader, listSessions } from '@introspection/read/node'
import type { TraceEvent } from '@introspection/types'
import { writeFileSync } from 'fs'
import { resolve } from 'path'

const directory = process.argv[2] ?? '.introspect'
const outputPath = process.argv[3] ?? 'report.html'

const COLORS: Record<string, string> = {
  'playwright.action': '#6c9cfc',
  'network.request': '#8bc38b',
  'network.response': '#59a359',
  'network.error': '#fc6c6c',
  'js.error': '#fc6c6c',
  'console': '#fcb86c',
  'playwright.result': '#c084fc',
  'browser.navigate': '#e0e0e0',
  'mark': '#e0e0e0',
}

function formatEvent(event: TraceEvent): string {
  switch (event.type) {
    case 'playwright.action':
      return `${event.data.method}(${event.data.args.map(argument => JSON.stringify(argument)).join(', ')})`
    case 'network.request':
      return `${event.data.method} ${event.data.url}`
    case 'network.response':
      return `${event.data.status} ${event.data.url}`
    case 'network.error':
      return `${event.data.url} — ${event.data.errorText}`
    case 'js.error':
      return event.data.message
    case 'console':
      return `[${event.data.level}] ${event.data.message}`
    case 'playwright.result':
      return `${event.data.status ?? 'unknown'}${event.data.duration ? ` (${event.data.duration}ms)` : ''}`
    case 'browser.navigate':
      return `${event.data.from} → ${event.data.to}`
    case 'mark':
      return event.data.label
    default:
      return JSON.stringify(event.data)
  }
}

function renderSession(sessionId: string, events: TraceEvent[]): string {
  const result = events.find(event => event.type === 'playwright.result')
  const status = result?.type === 'playwright.result' ? (result.data.status ?? 'unknown') : 'unknown'
  const statusColor = status === 'passed' ? '#8bc38b' : status === 'failed' ? '#fc6c6c' : '#fcb86c'

  const rows = events.map(event => {
    const color = COLORS[event.type] ?? '#888'
    return `      <tr>
        <td style="color: #666; font-variant-numeric: tabular-nums">${event.timestamp}ms</td>
        <td style="color: ${color}; font-weight: 500">${event.type}</td>
        <td style="color: #999">${formatEvent(event)}</td>
      </tr>`
  }).join('\n')

  return `    <div class="session">
      <h2><span class="status" style="color: ${statusColor}">${status}</span> ${sessionId}</h2>
      <table>
${rows}
      </table>
    </div>`
}

async function generate() {
  const resolvedDirectory = resolve(directory)
  const sessions = await listSessions(resolvedDirectory)

  if (sessions.length === 0) {
    console.error(`No sessions found in ${resolvedDirectory}`)
    process.exit(1)
  }

  const sections: string[] = []

  for (const summary of sessions) {
    const session = await createSessionReader(resolvedDirectory, summary.id)
    const events = await session.events.ls()
    sections.push(renderSession(summary.id, events))
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Introspection Report</title>
  <style>
    * { margin: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; max-width: 1000px; margin: 0 auto; }
    h1 { font-size: 18px; color: #888; margin-bottom: 24px; }
    .session { background: #111; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .session h2 { font-size: 14px; margin-bottom: 12px; color: #ccc; }
    .status { font-weight: 600; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    td { padding: 4px 8px; vertical-align: top; }
    td:first-child { width: 60px; }
    td:nth-child(2) { width: 160px; white-space: nowrap; }
  </style>
</head>
<body>
  <h1>Introspection Report — ${sessions.length} session${sessions.length === 1 ? '' : 's'}</h1>
${sections.join('\n')}
</body>
</html>`

  writeFileSync(outputPath, html)
  console.log(`Report written to ${outputPath} (${sessions.length} sessions)`)
}

generate()
