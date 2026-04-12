import type { TraceEvent } from '@introspection/types'
import { createSessionReader, listSessions } from '@introspection/read'
import { createFetchAdapter } from '@introspection/demo-shared/fetch-adapter'
import './widgets/event-graph.js'

const adapter = createFetchAdapter('/__introspect')
const selectElement = document.getElementById('session-select') as HTMLSelectElement
const graphElement = document.querySelector('event-graph') as HTMLElement & { load(events: TraceEvent[]): void }

async function loadSession(sessionId: string) {
  const session = await createSessionReader(adapter, { sessionId })
  const events = await session.events.ls()
  graphElement.load(events)
}

const sessions = await listSessions(adapter)
if (sessions.length === 0) {
  selectElement.innerHTML = '<option value="">No sessions</option>'
} else {
  selectElement.innerHTML = sessions
    .map(session => `<option value="${session.id}">${session.label ?? session.id}</option>`)
    .join('')
  selectElement.addEventListener('change', () => loadSession(selectElement.value))
  loadSession(sessions[0].id)
}
