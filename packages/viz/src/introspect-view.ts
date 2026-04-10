import type { TraceEvent } from '@introspection/types'
import type {
  SessionData,
  SelectionState,
  IntrospectionContext,
  EventsFilter,
} from './context.js'
import { CONTEXT_KEY } from './context.js'

export class IntrospectView extends HTMLElement {
  #session: SessionData | null = null
  #selection: SelectionState = {
    eventId: null,
    timeRange: null,
    typeFilters: new Set(),
  }
  #subscribers = new Set<() => void>()
  #context: IntrospectionContext | null = null
  #pendingRequests: Array<(context: IntrospectionContext) => void> = []

  constructor() {
    super()
    this.addEventListener(CONTEXT_KEY, this.#handleContextRequest)
  }

  get session(): SessionData | null {
    return this.#session
  }

  set session(data: SessionData) {
    this.#session = data
    this.#context = null // invalidate cached context
    this.#flushPendingRequests()
    this.#notify()
  }

  disconnectedCallback() {
    this.removeEventListener(CONTEXT_KEY, this.#handleContextRequest)
    this.#subscribers.clear()
    this.#pendingRequests.length = 0
  }

  #handleContextRequest = (event: CustomEvent) => {
    event.stopPropagation()
    event.preventDefault()
    const context = this.#getContext()
    if (context) {
      event.detail.callback(context)
    } else {
      this.#pendingRequests.push(event.detail.callback)
    }
  }

  #flushPendingRequests() {
    const context = this.#getContext()
    if (!context) return
    for (const callback of this.#pendingRequests) {
      callback(context)
    }
    this.#pendingRequests.length = 0
  }

  #getContext(): IntrospectionContext | null {
    if (!this.#session) return null
    if (this.#context) return this.#context

    this.#context = {
      session: this.#session,
      selection: this.#selection,
      subscribe: (callback) => {
        this.#subscribers.add(callback)
        return () => this.#subscribers.delete(callback)
      },
      select: (update) => {
        if (update.eventId !== undefined) this.#selection.eventId = update.eventId
        if (update.timeRange !== undefined) this.#selection.timeRange = update.timeRange
        if (update.typeFilters !== undefined) this.#selection.typeFilters = update.typeFilters
        this.#notify()
      },
      queryEvents: (filter) => this.#queryEvents(filter),
    }

    return this.#context
  }

  #queryEvents(filter?: EventsFilter): TraceEvent[] {
    if (!this.#session) return []
    let events = this.#session.events

    if (filter?.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type]
      events = events.filter(event => types.includes(event.type as typeof types[number]))
    }
    if (filter?.source) {
      events = events.filter(event => event.source === filter.source)
    }
    if (filter?.since !== undefined) {
      events = events.filter(event => event.timestamp >= filter.since!)
    }
    if (filter?.until !== undefined) {
      events = events.filter(event => event.timestamp <= filter.until!)
    }

    // Apply selection time range if active
    const range = this.#selection.timeRange
    if (range) {
      events = events.filter(event => event.timestamp >= range[0] && event.timestamp <= range[1])
    }

    // Apply type filters if active
    if (this.#selection.typeFilters.size > 0) {
      events = events.filter(event => this.#selection.typeFilters.has(event.type))
    }

    return events
  }

  #notify() {
    for (const callback of this.#subscribers) {
      callback()
    }
  }
}

customElements.define('introspect-view', IntrospectView)
