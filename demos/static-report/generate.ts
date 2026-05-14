import { createSessionReader, listRuns, listSessions } from '@introspection/read/node'
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
      return `${event.metadata.method}(${event.metadata.args.map(argument => JSON.stringify(argument)).join(', ')})`
    case 'network.request':
      return `${event.metadata.method} ${event.metadata.url}`
    case 'network.response':
      return `${event.metadata.status} ${event.metadata.url}`
    case 'network.error':
      return `${event.metadata.url} — ${event.metadata.errorText}`
    case 'js.error':
      return event.metadata.message
    case 'console':
      return `[${event.metadata.level}] ${event.metadata.args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`
    case 'playwright.result':
      return `${event.metadata.status ?? 'unknown'}${event.metadata.duration ? ` (${event.metadata.duration}ms)` : ''}`
    case 'browser.navigate':
      return `${event.metadata.from} → ${event.metadata.to}`
    case 'mark':
      return event.metadata.label
    default:
      return ''
  }
}

function renderSession(sessionId: string, events: TraceEvent[]): string {
  const result = events.find(event => event.type === 'playwright.result')
  const status = result?.type === 'playwright.result' ? (result.metadata.status ?? 'unknown') : 'unknown'
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
  const runs = await listRuns(resolvedDirectory)

  if (runs.length === 0) {
    console.error(`No runs found in ${resolvedDirectory}`)
    process.exit(1)
  }

  const sections: string[] = []

  for (const run of runs) {
    for (const summary of await listSessions(resolvedDirectory, run.id)) {
      const session = await createSessionReader(resolvedDirectory, { runId: run.id, sessionId: summary.id })
      const events = await session.events.ls()
      sections.push(renderSession(`${run.id}/${summary.id}`, events))
    }
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
  <h1>Introspection Report — ${sections.length} session${sections.length === 1 ? '' : 's'}</h1>
${sections.join('\n')}
</body>
</html>`

  writeFileSync(outputPath, html)
  console.log(`Report written to ${outputPath} (${sections.length} sessions)`)
}

generate()
