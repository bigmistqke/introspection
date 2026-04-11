import { requestSession } from '../../src/index.js'

class EventDetail extends HTMLElement {
  async connectedCallback() {
    await requestSession(this)

    this.attachShadow({ mode: 'open' })
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: block; background: #111; border-radius: 8px; padding: 16px; overflow-y: auto; }
        .empty { color: #666; font-style: italic; }
        h3 { font-size: 14px; margin-bottom: 12px; color: #ccc; }
        .field { margin-bottom: 8px; }
        .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin-bottom: 2px; }
        .value { font-size: 13px; font-family: 'SF Mono', 'Fira Code', monospace; word-break: break-all; }
        pre {
          background: #0a0a0a;
          border-radius: 4px;
          padding: 8px;
          font-size: 12px;
          overflow-x: auto;
          white-space: pre-wrap;
          color: #ccc;
        }
      </style>
      <div class="empty">Select an event</div>
    `

    // Listen for selections from sibling widgets
    this.closest('introspect-session')?.addEventListener('event-select', ((event: CustomEvent) => {
      this.#renderEvent(event.detail.event)
    }) as EventListener)
  }

  #renderEvent(event: Record<string, unknown>) {
    if (!this.shadowRoot) return

    const style = this.shadowRoot.querySelector('style')!.outerHTML

    this.shadowRoot.innerHTML = `
      ${style}
      <h3>${event.type}</h3>
      <div class="field">
        <div class="label">Timestamp</div>
        <div class="value">${event.timestamp}ms</div>
      </div>
      <div class="field">
        <div class="label">Source</div>
        <div class="value">${event.source}</div>
      </div>
      ${event.initiator ? `
        <div class="field">
          <div class="label">Initiator</div>
          <div class="value">${event.initiator}</div>
        </div>
      ` : ''}
      <div class="field">
        <div class="label">Data</div>
        <pre>${JSON.stringify(event.data, null, 2)}</pre>
      </div>
    `
  }
}

customElements.define('event-detail', EventDetail)
