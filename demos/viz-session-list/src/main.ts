import '@introspection/viz'
import './widgets/session-summary.js'
import { adapter, sessionIds } from './fake-data.js'
import { createSessionReader } from '@introspection/read'
import type { IntrospectSession } from '@introspection/viz'

const container = document.getElementById('sessions')!

for (const id of sessionIds) {
  const sessionElement = document.createElement('introspect-session') as IntrospectSession
  const summary = document.createElement('session-summary')
  sessionElement.appendChild(summary)
  container.appendChild(sessionElement)

  createSessionReader(adapter, id).then(session => {
    sessionElement.session = session
  })
}
