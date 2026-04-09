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

  window.__introspect_plugins__ = window.__introspect_plugins__ || {}
  ;(window.__introspect_plugins__ as Record<string, unknown>).performance = {}
})()
