import { requestSession } from '@introspection/viz'

const COLORS: Record<string, string> = {
  'playwright.action': '#6c9cfc',
  'network.request': '#8bc38b',
  'network.response': '#8bc38b',
  'js.error': '#fc6c6c',
  'console': '#fcb86c',
  'playwright.result': '#c084fc',
}

class EventTimeline extends HTMLElement {
  async connectedCallback() {
    const session = await requestSession(this)

    this.attachShadow({ mode: 'open' })
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: block; overflow-y: auto; background: #111; border-radius: 8px; padding: 12px; }
        .event {
          display: grid;
          grid-template-columns: 60px 1fr;
          gap: 8px;
          padding: 8px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          line-height: 1.4;
        }
        .event:hover { background: #1a1a1a; }
        .event[aria-selected="true"] { background: #1e293b; }
        .timestamp { color: #666; font-variant-numeric: tabular-nums; }
        .type { font-weight: 500; }
        .summary { color: #999; }
      </style>
    `

    const events = await session.events.ls()

    for (const event of events) {
      const row = document.createElement('div')
      row.className = 'event'

      const color = COLORS[event.type] ?? '#888'
      const summary = formatEvent(event)

      row.innerHTML = `
        <span class="timestamp">${event.timestamp}ms</span>
        <span>
          <span class="type" style="color: ${color}">${event.type}</span>
          <span class="summary"> ${summary}</span>
        </span>
      `

      row.addEventListener('click', () => {
        this.shadowRoot!.querySelector('[aria-selected="true"]')?.setAttribute('aria-selected', 'false')
        row.setAttribute('aria-selected', 'true')
        this.dispatchEvent(new CustomEvent('event-select', {
          bubbles: true, composed: true,
          detail: { event },
        }))
      })

      this.shadowRoot!.appendChild(row)
    }
  }
}

function formatEvent(event: Record<string, unknown>): string {
  const data = event.data as Record<string, unknown> | undefined
  if (!data) return ''
  switch (event.type) {
    case 'playwright.action':
      return `${data.method}(${(data.args as unknown[]).map(argument => JSON.stringify(argument)).join(', ')})`
    case 'network.request':
    case 'network.response':
      return `${data.method ?? (data.status ?? '')} ${data.url}`
    case 'js.error':
      return String(data.message ?? '')
    case 'console':
      return `[${data.level}] ${data.message}`
    case 'playwright.result':
      return `${data.status} (${data.duration}ms)`
    default:
      return ''
  }
}

customElements.define('event-timeline', EventTimeline)
