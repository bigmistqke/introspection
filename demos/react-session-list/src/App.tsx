import { useState, useEffect } from 'react'
import { listSessions } from '@introspection/read'
import { createFetchAdapter } from '@introspection/demo-shared/fetch-adapter'
import type { SessionSummary } from '@introspection/read'
import { SessionCard } from './SessionCard.jsx'

const adapter = createFetchAdapter('/__introspect')

export default function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listSessions(adapter).then((result) => {
      setSessions(result)
      setLoading(false)
    })
  }, [])

  if (loading) return <p style={{ color: '#666' }}>Loading sessions...</p>
  if (sessions.length === 0) return <p style={{ color: '#fc6c6c' }}>No sessions found in .introspect/</p>

  return (
    <>
      <h1>Sessions ({sessions.length})</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
        {sessions.map(session => (
          <SessionCard key={session.id} adapter={adapter} summary={session} />
        ))}
      </div>
    </>
  )
}
