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

  const IMPLICIT_ROLES: Record<string, string> = {
    button: 'button',
    a: 'link',           // only when href is present (handled below)
    textarea: 'textbox',
    select: 'combobox',
    nav: 'navigation',
    main: 'main',
    header: 'banner',
    footer: 'contentinfo',
    aside: 'complementary',
  }
  const INPUT_ROLES: Record<string, string> = {
    text: 'textbox', search: 'searchbox', email: 'textbox', tel: 'textbox',
    url: 'textbox', password: 'textbox', number: 'spinbutton',
    checkbox: 'checkbox', radio: 'radio', range: 'slider',
    submit: 'button', button: 'button', reset: 'button',
  }

  function implicitRole(element: Element): string | null {
    const tag = element.tagName.toLowerCase()
    if (tag === 'input') {
      const type = (element.getAttribute('type') ?? 'text').toLowerCase()
      return INPUT_ROLES[type] ?? 'textbox'
    }
    if (tag === 'a') return element.hasAttribute('href') ? 'link' : null
    return IMPLICIT_ROLES[tag] ?? null
  }

  function accessibleNameOf(element: Element): string | null {
    const ariaLabel = element.getAttribute('aria-label')
    if (ariaLabel) return ariaLabel.trim() || null
    const labelledBy = element.getAttribute('aria-labelledby')
    if (labelledBy) {
      const referenced = labelledBy.split(/\s+/).map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '').join(' ').trim()
      if (referenced) return referenced
    }
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
      const id = element.id
      if (id) {
        const label = element.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`)
        if (label?.textContent) return label.textContent.trim() || null
      }
      const closest = element.closest('label')
      if (closest?.textContent) return closest.textContent.trim() || null
    }
    const text = (element as HTMLElement).innerText?.trim()
    if (text) return text.length > 120 ? text.slice(0, 117) + '…' : text
    return null
  }

  function selectorFor(element: Element): string {
    const tag = element.tagName.toLowerCase()
    if (element.id) return `${tag}#${element.id}`
    const segments: string[] = []
    let current: Element | null = element
    let depth = 0
    while (current && current !== current.ownerDocument.documentElement && depth < 6) {
      const segmentTag = current.tagName.toLowerCase()
      if (current.id) {
        segments.unshift(`${segmentTag}#${current.id}`)
        break
      }
      const parent = current.parentElement
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === current!.tagName)
        const index = sameTag.indexOf(current)
        segments.unshift(sameTag.length > 1 ? `${segmentTag}:nth-of-type(${index + 1})` : segmentTag)
      } else {
        segments.unshift(segmentTag)
      }
      current = parent
      depth++
    }
    return segments.join(' > ')
  }

  function describe(element: Element | null): ElementInfo | null {
    if (!element) return null
    const tag = element.tagName.toLowerCase()
    const text = (element as HTMLElement).innerText?.trim() ?? null
    return {
      tag,
      id: element.id || null,
      classList: Array.from(element.classList),
      testid: element.getAttribute('data-testid'),
      role: element.getAttribute('role') ?? implicitRole(element),
      accessibleName: accessibleNameOf(element),
      text: text ? (text.length > 120 ? text.slice(0, 117) + '…' : text) : null,
      selector: selectorFor(element),
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

  function deepActiveElement(): { element: Element | null; shadowPath: string[] } {
    const path: string[] = []
    let current: Element | null = document.activeElement
    while (current && (current as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot) {
      const shadow = (current as Element & { shadowRoot: ShadowRoot }).shadowRoot
      const next = shadow.activeElement
      if (!next) break
      path.push(selectorFor(current))
      current = next
    }
    return { element: current, shadowPath: path }
  }

  function describeDeep(): ElementInfo | null {
    const { element, shadowPath } = deepActiveElement()
    const info = describe(element)
    if (info && shadowPath.length > 0) info.shadowPath = shadowPath
    return info
  }

  document.addEventListener('focusin', () => {
    emitChange(describeDeep(), pendingProgrammatic)
  }, true)

  document.addEventListener('focusout', (event) => {
    if ((event as FocusEvent).relatedTarget !== null) return
    queueMicrotask(() => {
      const active = document.activeElement
      if (!active || active === document.body) {
        emitChange(null, pendingProgrammatic)
      }
    })
  }, true)
})()
