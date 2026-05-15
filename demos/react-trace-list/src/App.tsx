import { Suspense, use } from 'react'
import { listRuns, listTraces } from '@introspection/read'
import { createHttpReadAdapter } from '@introspection/serve/client'
import { TraceCard } from './TraceCard.jsx'

const baseUrl = typeof window !== 'undefined'
  ? `${window.location.origin}/__introspect`
  : 'http://localhost:5175/__introspect'

const adapter = createHttpReadAdapter(baseUrl)
// Demo: show the latest run's traces. createTraceReader({ traceId })
// downstream resolves within that same latest run.
const tracesPromise = listRuns(adapter).then(runs =>
  runs.length > 0 ? listTraces(adapter, runs[0].id) : [],
)

export default function App() {
  const traces = use(tracesPromise)

  if (traces.length === 0) return <p style={{ color: '#fc6c6c' }}>No traces found in .introspect/</p>

  return (
    <>
      <h1>Traces ({traces.length})</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
        {traces.map(trace => (
          <Suspense key={trace.id} fallback={
            <div style={{ background: '#111', borderRadius: 8, padding: '12px 16px', color: '#666', fontSize: 13 }}>
              Loading {trace.label ?? trace.id}...
            </div>
          }>
            <TraceCard adapter={adapter} summary={trace} />
          </Suspense>
        ))}
      </div>
    </>
  )
}
