import type { SessionReader } from '@introspection/types'

// ─── Context protocol ────────────────────────────────────────────────────────
//
// Follows the web component community context protocol pattern.
// A widget dispatches a 'introspection-context-request' event.
// The nearest <introspect-session> ancestor catches it and calls the callback
// with the session.

export const CONTEXT_KEY = 'introspection-context-request'

export interface IntrospectionContextEvent {
  callback: (session: SessionReader) => void
}

declare global {
  interface HTMLElementEventMap {
    [CONTEXT_KEY]: CustomEvent<IntrospectionContextEvent>
  }
}

export function requestSession(element: HTMLElement): Promise<SessionReader> {
  return new Promise((resolve, reject) => {
    const event = new CustomEvent(CONTEXT_KEY, {
      bubbles: true,
      composed: true,
      cancelable: true,
      detail: {
        callback: (session: SessionReader) => resolve(session),
      },
    })
    element.dispatchEvent(event)

    // The host calls preventDefault when it catches the event.
    // If defaultPrevented is false, no host is in the ancestor chain.
    if (!event.defaultPrevented) {
      reject(new Error(
        'No <introspect-session> ancestor found. ' +
        'Wrap your widget in an <introspect-session> element.'
      ))
    }
  })
}
