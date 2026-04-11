import type { TraceEvent } from '@introspection/types'

const COLORS: Record<string, string> = {
  'playwright.action': '#6c9cfc',
  'network.request': '#8bc38b',
  'network.response': '#8bc38b',
  'js.error': '#fc6c6c',
  'console': '#fcb86c',
  'playwright.result': '#c084fc',
  'browser.navigate': '#e0e0e0',
}

class LiveTimeline extends HTMLElement {
  #list: HTMLElement | null = null

  connectedCallback() {
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
          font-size: 13px;
          line-height: 1.4;
          animation: slideIn 0.25s ease-out;
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(-8px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .timestamp { color: #666; font-variant-numeric: tabular-nums; }
        .type { font-weight: 500; }
        .summary { color: #999; }
        .waiting { color: #555; font-style: italic; padding: 8px; }
      </style>
      <div class="waiting">Waiting for events...</div>
      <div id="list"></div>
    `
    this.#list = this.shadowRoot!.getElementById('list')!
  }

  addEvent(event: TraceEvent) {
    if (!this.#list) return

    const waiting = this.shadowRoot!.querySelector('.waiting')
    if (waiting) waiting.remove()

    const row = document.createElement('div')
    row.className = 'event'

    const color = COLORS[event.type] ?? '#888'
    const summary = this.#formatEvent(event)

    row.innerHTML = `
      <span class="timestamp">${event.timestamp}ms</span>
      <span>
        <span class="type" style="color: ${color}">${event.type}</span>
        <span class="summary"> ${summary}</span>
      </span>
    `

    this.#list.appendChild(row)
    this.scrollTop = this.scrollHeight
  }

  clear() {
    if (!this.#list) return
    this.#list.innerHTML = ''
    const style = this.shadowRoot!.querySelector('style')!
    style.insertAdjacentHTML('afterend', '<div class="waiting">Waiting for events...</div>')
  }

  #formatEvent(event: TraceEvent): string {
    const data = (event as Record<string, unknown>).data as Record<string, unknown> | undefined
    if (!data) return ''
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
}

customElements.define('live-timeline', LiveTimeline)
