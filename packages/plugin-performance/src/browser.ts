// Browser-side performance instrumentation script.
// Bundled as IIFE and embedded into index.ts at build time.
// No imports — runs standalone in the browser.

;(() => {
  function push(type: string, data: Record<string, unknown>): void {
    ;(window as unknown as { __introspect_push__: (payload: string) => void }).__introspect_push__(
      JSON.stringify({ type, data })
    )
  }

  function observePaint(): void {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        push('perf.paint', {
          name: entry.name,
          startTime: entry.startTime,
        })
      }
    })
    observer.observe({ type: 'paint', buffered: true })
  }

  observePaint()

  function observeLcp(): void {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const lcpEntry = entry as PerformanceLargestContentfulPaint
        push('perf.cwv', {
          metric: 'lcp',
          value: lcpEntry.renderTime || lcpEntry.loadTime,
          element: lcpEntry.element?.tagName?.toLowerCase(),
          url: lcpEntry.url || undefined,
          size: lcpEntry.size,
          startTime: lcpEntry.startTime,
        })
      }
    })
    observer.observe({ type: 'largest-contentful-paint', buffered: true })
  }

  observeLcp()

  function selectorForElement(element: Element | null): string | undefined {
    if (!element) return undefined
    if (element.id) return `#${element.id}`
    const tag = element.tagName.toLowerCase()
    const classes = Array.from(element.classList).join('.')
    return classes ? `${tag}.${classes}` : tag
  }

  function observeLayoutShift(): void {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const layoutShift = entry as LayoutShift
        push('perf.layout-shift', {
          score: layoutShift.value,
          hadRecentInput: layoutShift.hadRecentInput,
          sources: (layoutShift.sources || []).map((source) => ({
            selector: selectorForElement(source.node),
            previousRect: {
              x: source.previousRect.x,
              y: source.previousRect.y,
              width: source.previousRect.width,
              height: source.previousRect.height,
            },
            currentRect: {
              x: source.currentRect.x,
              y: source.currentRect.y,
              width: source.currentRect.width,
              height: source.currentRect.height,
            },
          })),
        })
      }
    })
    observer.observe({ type: 'layout-shift', buffered: true })
  }

  observeLayoutShift()

  window.__introspect_plugins__ = window.__introspect_plugins__ || {}
  ;(window.__introspect_plugins__ as Record<string, unknown>).performance = {}
})()
