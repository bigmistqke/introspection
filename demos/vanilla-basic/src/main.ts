import { createSessionReader, listSessions } from '@introspection/read'
import { createFetchAdapter } from '@introspection/demo-shared/fetch-adapter'
import type { TraceEvent } from '@introspection/types'

const COLORS: Record<string, string> = {
  'playwright.action': '#6c9cfc',
  'network.request': '#8bc38b',
  'network.response': '#59a359',
  'network.error': '#fc6c6c',
  'js.error': '#fc6c6c',
  'console': '#fcb86c',
  'playwright.result': '#c084fc',
  'browser.navigate': '#e0e0e0',
}

const adapter = createFetchAdapter('/__introspect')
const timelineElement = document.getElementById('timeline')!
const detailElement = document.getElementById('detail')!
const selectElement = document.getElementById('session-select') as HTMLSelectElement

function formatEvent(event: TraceEvent): string {
  const data = (event as Record<string, unknown>).data as Record<string, unknown>
  switch (event.type) {
    case 'playwright.action':
      return `${data.method}(${(data.args as unknown[]).map(argument => JSON.stringify(argument)).join(', ')})`
    case 'network.request':
    case 'network.response':
      return `${data.method ?? data.status ?? ''} ${data.url}`
    case 'js.error':
      return String(data.message ?? '')
    case 'console':
      return `[${data.level}] ${data.message}`
    case 'playwright.result':
      return `${data.status} (${data.duration}ms)`
    case 'browser.navigate':
      return `${data.from} → ${data.to}`
    default:
      return ''
  }
}

function renderTimeline(events: TraceEvent[]) {
  timelineElement.innerHTML = ''
  for (const event of events) {
    const row = document.createElement('div')
    row.className = 'event'
    const color = COLORS[event.type] ?? '#888'
    row.innerHTML = `
      <span class="timestamp">${event.timestamp}ms</span>
      <span>
        <span class="type" style="color: ${color}">${event.type}</span>
        <span class="summary"> ${formatEvent(event)}</span>
      </span>
    `
    row.addEventListener('click', () => {
      timelineElement.querySelector('.selected')?.classList.remove('selected')
      row.classList.add('selected')
      renderDetail(event)
    })
    timelineElement.appendChild(row)
  }
}

function renderDetail(event: TraceEvent) {
  const data = (event as Record<string, unknown>).data
  detailElement.innerHTML = `
    <h3>${event.type}</h3>
    <div class="field">
      <div class="label">Timestamp</div>
      <div class="value">${event.timestamp}ms</div>
    </div>
    <div class="field">
      <div class="label">Source</div>
      <div class="value">${event.source}</div>
    </div>
    ${event.initiator ? `<div class="field"><div class="label">Initiator</div><div class="value">${event.initiator}</div></div>` : ''}
    <div class="field">
      <div class="label">Data</div>
      <pre>${JSON.stringify(data, null, 2)}</pre>
    </div>
  `
}

async function loadSession(sessionId: string) {
  const session = await createSessionReader(adapter, sessionId)
  const events = await session.events.ls()
  renderTimeline(events)
  detailElement.innerHTML = '<span class="empty">Select an event</span>'
}

const sessions = await listSessions(adapter)
if (sessions.length === 0) {
  timelineElement.innerHTML = '<span class="error">No sessions found in .introspect/</span>'
  selectElement.innerHTML = '<option value="">No sessions</option>'
} else {
  selectElement.innerHTML = sessions
    .map(session => `<option value="${session.id}">${session.label ?? session.id}</option>`)
    .join('')
  selectElement.addEventListener('change', () => loadSession(selectElement.value))
  loadSession(sessions[0].id)
}
