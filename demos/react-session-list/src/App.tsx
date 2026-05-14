import { Suspense, use } from 'react'
import { listRuns, listSessions } from '@introspection/read'
import { createFetchAdapter } from '@introspection/demo-shared/fetch-adapter'
import { SessionCard } from './SessionCard.jsx'

const baseUrl = typeof window !== 'undefined'
  ? `${window.location.origin}/__introspect`
  : 'http://localhost:5175/__introspect'

const adapter = createFetchAdapter(baseUrl)
// Demo: show the latest run's sessions. createSessionReader({ sessionId })
// downstream resolves within that same latest run.
const sessionsPromise = listRuns(adapter).then(runs =>
  runs.length > 0 ? listSessions(adapter, runs[0].id) : [],
)

export default function App() {
  const sessions = use(sessionsPromise)

  if (sessions.length === 0) return <p style={{ color: '#fc6c6c' }}>No sessions found in .introspect/</p>

  return (
    <>
      <h1>Sessions ({sessions.length})</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
        {sessions.map(session => (
          <Suspense key={session.id} fallback={
            <div style={{ background: '#111', borderRadius: 8, padding: '12px 16px', color: '#666', fontSize: 13 }}>
              Loading {session.label ?? session.id}...
            </div>
          }>
            <SessionCard adapter={adapter} summary={session} />
          </Suspense>
        ))}
      </div>
    </>
  )
}
