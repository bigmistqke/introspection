import { requestSession } from '@introspection/viz'

const STATUS_COLORS: Record<string, string> = {
  passed: '#8bc38b',
  failed: '#fc6c6c',
  timedOut: '#fcb86c',
  skipped: '#888',
}

class SessionSummary extends HTMLElement {
  async connectedCallback() {
    const session = await requestSession(this)
    const events = await session.events.ls()

    const result = events.find(event => event.type === 'playwright.result')
    const resultData = result ? (result as Record<string, unknown>).data as Record<string, unknown> : null
    const status = resultData?.status as string ?? 'unknown'
    const duration = resultData?.duration as number ?? 0
    const error = resultData?.error as string | undefined

    const errors = events.filter(event => event.type === 'js.error')
    const requests = events.filter(event => event.type === 'network.request')
    const actions = events.filter(event => event.type === 'playwright.action')

    this.attachShadow({ mode: 'open' })
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: block; background: #111; border-radius: 8px; border-left: 3px solid ${STATUS_COLORS[status] ?? '#888'}; }
        .header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; cursor: pointer; }
        .header:hover { background: #1a1a1a; border-radius: 0 8px 8px 0; }
        .title { font-size: 14px; font-weight: 500; }
        .meta { display: flex; gap: 16px; font-size: 12px; color: #888; }
        .status { color: ${STATUS_COLORS[status] ?? '#888'}; font-weight: 500; }
        .details { display: none; padding: 0 16px 12px; border-top: 1px solid #1a1a1a; }
        .details.open { display: block; }
        .error { color: #fc6c6c; font-size: 12px; font-family: 'SF Mono', monospace; padding: 8px; background: #1a0a0a; border-radius: 4px; margin-top: 8px; }
        .events { margin-top: 8px; }
        .event-row {
          display: grid;
          grid-template-columns: 50px 1fr;
          gap: 8px;
          padding: 4px 0;
          font-size: 12px;
        }
        .event-row .ts { color: #555; font-variant-numeric: tabular-nums; }
        .event-row .type { color: #999; }
      </style>
      <div class="header">
        <span class="title">${session.id}</span>
        <div class="meta">
          <span>${actions.length} actions</span>
          <span>${requests.length} requests</span>
          ${errors.length > 0 ? `<span style="color: #fc6c6c">${errors.length} errors</span>` : ''}
          <span>${duration}ms</span>
          <span class="status">${status}</span>
        </div>
      </div>
      <div class="details">
        ${error ? `<div class="error">${error}</div>` : ''}
        <div class="events">
          ${events.map(event => {
            const data = (event as Record<string, unknown>).data as Record<string, unknown>
            let label = event.type
            if (data.method && data.url) label = `${data.method} ${data.url}`
            else if (data.method && data.args) label = `${data.method}(${(data.args as unknown[]).map(argument => JSON.stringify(argument)).join(', ')})`
            else if (data.message) label = String(data.message)
            else if (data.status && data.duration) label = `${data.status} (${data.duration}ms)`
            return `<div class="event-row"><span class="ts">${event.timestamp}ms</span><span class="type">${label}</span></div>`
          }).join('')}
        </div>
      </div>
    `

    this.shadowRoot!.querySelector('.header')!.addEventListener('click', () => {
      this.shadowRoot!.querySelector('.details')!.classList.toggle('open')
    })
  }
}

customElements.define('session-summary', SessionSummary)
