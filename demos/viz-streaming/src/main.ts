import './widgets/live-timeline.js'
import type { TraceEvent } from '@introspection/types'

const timeline = document.querySelector('live-timeline')! as HTMLElement & { addEvent(event: TraceEvent): void; clear(): void }
const connectButton = document.getElementById('connect')!
const statusElement = document.getElementById('status')!

let source: EventSource | null = null

function connect() {
  if (source) source.close()
  timeline.clear()

  source = new EventSource('/events')
  statusElement.textContent = 'Connected'
  statusElement.className = 'status live'

  source.addEventListener('message', (message) => {
    const event = JSON.parse(message.data) as TraceEvent
    timeline.addEvent(event)
  })

  source.addEventListener('done', () => {
    statusElement.textContent = 'Stream complete'
    statusElement.className = 'status'
    source?.close()
    source = null
  })

  source.addEventListener('error', () => {
    statusElement.textContent = 'Disconnected'
    statusElement.className = 'status'
    source?.close()
    source = null
  })
}

connectButton.addEventListener('click', connect)
