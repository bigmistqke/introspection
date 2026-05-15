import type { TraceEvent } from '@introspection/types'
import { createTraceReader, listRuns, listTraces } from '@introspection/read'
import { createHttpReadAdapter } from '@introspection/serve/client'
import './widgets/event-graph.js'

const adapter = createHttpReadAdapter('/__introspect')
const selectElement = document.getElementById('trace-select') as HTMLSelectElement
const graphElement = document.querySelector('event-graph') as HTMLElement & { load(events: TraceEvent[]): void }

async function loadTrace(traceId: string) {
  const trace = await createTraceReader(adapter, { traceId })
  const events = await trace.events.ls()
  graphElement.load(events)
}

// Demo: show the latest run's traces.
const runs = await listRuns(adapter)
const traces = runs.length > 0 ? await listTraces(adapter, runs[0].id) : []
if (traces.length === 0) {
  selectElement.innerHTML = '<option value="">No traces</option>'
} else {
  selectElement.innerHTML = traces
    .map(trace => `<option value="${trace.id}">${trace.label ?? trace.id}</option>`)
    .join('')
  selectElement.addEventListener('change', () => loadTrace(selectElement.value))
  loadTrace(traces[0].id)
}
