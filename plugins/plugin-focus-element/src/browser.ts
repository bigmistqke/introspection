type ConfigEntry = { kind: 'string'; value: string } | { kind: 'regex'; source: string; flags: string }
declare const __introspect_focus_config__: ConfigEntry[] | null

interface ElementInfo {
  tag: string
  id: string | null
  classList: string[]
  testid: string | null
  role: string | null
  accessibleName: string | null
  text: string | null
  selector: string
  shadowPath: string[] | null
  backendNodeId: number | null
}

;(() => {
  if (!originAllowed()) return

  function originAllowed(): boolean {
    const config = typeof __introspect_focus_config__ !== 'undefined' ? __introspect_focus_config__ : null
    if (!config) return true
    return config.some((entry) =>
      entry.kind === 'string'
        ? entry.value === location.origin
        : new RegExp(entry.source, entry.flags).test(location.origin)
    )
  }

  function push(metadata: Record<string, unknown>): void {
    ;(window as unknown as { __introspect_push__: (payload: string) => void }).__introspect_push__(
      JSON.stringify({ type: 'focus.changed', metadata })
    )
  }

  function describe(element: Element | null): ElementInfo | null {
    if (!element) return null
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      classList: Array.from(element.classList),
      testid: element.getAttribute('data-testid'),
      role: element.getAttribute('role'),
      accessibleName: element.getAttribute('aria-label'),
      text: null,
      selector: element.tagName.toLowerCase() + (element.id ? `#${element.id}` : ''),
      shadowPath: null,
      backendNodeId: null,
    }
  }

  function emitInitial(): void {
    const target = describe(document.activeElement)
    const metadata: Record<string, unknown> = {
      target,
      previous: null,
      cause: 'unknown',
    }
    if (window.top !== window) metadata.origin = location.origin
    push(metadata)
  }

  // Emit the initial snapshot once the page is fully settled.
  // In Chromium, autofocus fires a `focus` event AFTER `pageshow`. We wait for it.
  // If no focus event fires within a short window (no autofocus), fall back to emitting
  // the current activeElement (which will be body or null).
  let initialEmitted = false
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null

  function onInitialFocus(): void {
    if (initialEmitted) return
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer)
      fallbackTimer = null
    }
    initialEmitted = true
    emitInitial()
  }

  window.addEventListener('focus', onInitialFocus, { once: true, capture: true })

  window.addEventListener('pageshow', (event) => {
    if ((event as PageTransitionEvent).persisted) {
      initialEmitted = false
      window.addEventListener('focus', onInitialFocus, { once: true, capture: true })
      // Fallback in case there's no autofocus on the restored page
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null
        if (!initialEmitted) {
          initialEmitted = true
          emitInitial()
        }
      }, 100)
      return
    }
    // First load: autofocus focus event fires after pageshow; set a fallback
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null
      if (!initialEmitted) {
        initialEmitted = true
        emitInitial()
      }
    }, 100)
  })
})()
