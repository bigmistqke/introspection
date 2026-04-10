import type { TraceEvent, TraceEventMap, SessionMeta } from '@introspection/types'

// ─── Query types ─────────────────────────────────────────────────────────────

export interface EventsFilter {
  type?: keyof TraceEventMap | (keyof TraceEventMap)[]
  source?: TraceEvent['source']
  since?: number
  until?: number
}

export interface SessionData {
  meta: SessionMeta
  events: TraceEvent[]
  readAsset(path: string): Promise<string | ArrayBuffer>
}

// ─── Selection state ─────────────────────────────────────────────────────────

export interface SelectionState {
  /** Currently selected event id, or null */
  eventId: string | null
  /** Visible time range in ms (relative to session start) */
  timeRange: [start: number, end: number] | null
  /** Active event type filters */
  typeFilters: Set<string>
}

// ─── Context ─────────────────────────────────────────────────────────────────

export interface IntrospectionContext {
  session: SessionData
  selection: SelectionState
  subscribe(callback: () => void): () => void
  select(update: Partial<SelectionState>): void
  queryEvents(filter?: EventsFilter): TraceEvent[]
}

// ─── Context protocol ────────────────────────────────────────────────────────
//
// Follows the web component community context protocol pattern.
// A widget dispatches a 'introspection-context-request' event.
// The nearest <introspect-view> ancestor catches it and calls the callback
// with the context.

export const CONTEXT_KEY = 'introspection-context-request'

export interface IntrospectionContextEvent {
  callback: (context: IntrospectionContext) => void
}

declare global {
  interface HTMLElementEventMap {
    [CONTEXT_KEY]: CustomEvent<IntrospectionContextEvent>
  }
}

export function requestContext(element: HTMLElement): Promise<IntrospectionContext> {
  return new Promise((resolve, reject) => {
    const event = new CustomEvent(CONTEXT_KEY, {
      bubbles: true,
      composed: true,
      cancelable: true,
      detail: {
        callback: (context: IntrospectionContext) => resolve(context),
      },
    })
    element.dispatchEvent(event)

    // The host calls stopPropagation + preventDefault when it catches the event.
    // If defaultPrevented is false, no host is in the ancestor chain.
    if (!event.defaultPrevented) {
      reject(new Error(
        'No <introspect-view> ancestor found. ' +
        'Wrap your widget in an <introspect-view> element.'
      ))
    }
  })
}
