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

  let previous: ElementInfo | null = null

  let pendingProgrammatic: { stack: string } | null = null

  const realFocus = HTMLElement.prototype.focus
  HTMLElement.prototype.focus = function (this: HTMLElement, ...args: unknown[]) {
    pendingProgrammatic = { stack: cleanStack(new Error().stack ?? '') }
    try { return realFocus.apply(this, args as []) } finally { pendingProgrammatic = null }
  }

  const realBlur = HTMLElement.prototype.blur
  HTMLElement.prototype.blur = function (this: HTMLElement, ...args: unknown[]) {
    pendingProgrammatic = { stack: cleanStack(new Error().stack ?? '') }
    try { return realBlur.apply(this, args as []) } finally { pendingProgrammatic = null }
  }

  function cleanStack(stack: string): string {
    // Drop the first frame (the patch wrapper itself); keep everything else verbatim.
    const lines = stack.split('\n')
    return lines.length > 1 ? [lines[0], ...lines.slice(2)].join('\n') : stack
  }

  function emitChange(target: ElementInfo | null, programmatic: { stack: string } | null): void {
    const metadata: Record<string, unknown> = {
      target,
      previous,
      ...(programmatic ? { cause: 'programmatic', callSite: programmatic.stack } : { cause: 'unknown' }),
    }
    if (window.top !== window) metadata.origin = location.origin
    push(metadata)
    previous = target
  }

  document.addEventListener('focusin', () => {
    emitChange(describe(document.activeElement), pendingProgrammatic)
  }, true)
})()
