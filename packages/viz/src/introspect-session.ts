import type { SessionReader } from '@introspection/types'
import { CONTEXT_KEY } from './context.js'

export class IntrospectSession extends HTMLElement {
  #session: SessionReader | null = null
  #pendingRequests: Array<(session: SessionReader) => void> = []

  constructor() {
    super()
    this.addEventListener(CONTEXT_KEY, this.#handleContextRequest)
  }

  get session(): SessionReader | null {
    return this.#session
  }

  set session(data: SessionReader) {
    this.#session = data
    this.#flushPendingRequests()
  }

  disconnectedCallback() {
    this.removeEventListener(CONTEXT_KEY, this.#handleContextRequest)
    this.#pendingRequests.length = 0
  }

  #handleContextRequest = (event: CustomEvent) => {
    event.stopPropagation()
    event.preventDefault()
    if (this.#session) {
      event.detail.callback(this.#session)
    } else {
      this.#pendingRequests.push(event.detail.callback)
    }
  }

  #flushPendingRequests() {
    if (!this.#session) return
    for (const callback of this.#pendingRequests) {
      callback(this.#session)
    }
    this.#pendingRequests.length = 0
  }
}

customElements.define('introspect-session', IntrospectSession)
