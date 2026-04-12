// Browser-side performance instrumentation script.
// Bundled as IIFE and embedded into index.ts at build time.
// No imports — runs standalone in the browser.

;(() => {
  function push(type: string, metadata: Record<string, unknown>): void {
    ;(window as unknown as { __introspect_push__: (payload: string) => void }).__introspect_push__(
      JSON.stringify({ type, metadata })
    )
  }

  const config = (typeof __introspect_perf_config__ !== 'undefined' ? __introspect_perf_config__ : { resources: true, longTasks: true }) as { resources: boolean; longTasks: boolean }

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

  function selectorForElement(element: Element | null): string | undefined {
    if (!element) return undefined
    if (element.id) return `#${element.id}`
    const tag = element.tagName.toLowerCase()
    const classes = Array.from(element.classList).join('.')
    return classes ? `${tag}.${classes}` : tag
  }

  function observeLcp(): void {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const lcpEntry = entry as PerformanceLargestContentfulPaint
        push('perf.cwv', {
          metric: 'lcp',
          value: lcpEntry.renderTime || lcpEntry.loadTime,
          element: selectorForElement(lcpEntry.element),
          url: lcpEntry.url || undefined,
          size: lcpEntry.size,
          startTime: lcpEntry.startTime,
        })
      }
    })
    observer.observe({ type: 'largest-contentful-paint', buffered: true })
  }

  observeLcp()

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
        if (!layoutShift.hadRecentInput) {
          push('perf.cwv', {
            metric: 'cls',
            value: layoutShift.value,
            startTime: layoutShift.startTime,
          })
        }
      }
    })
    observer.observe({ type: 'layout-shift', buffered: true })
  }

  observeLayoutShift()

  function observeResource(): void {
    if (!config.resources) return
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const resource = entry as PerformanceResourceTiming
        push('perf.resource', {
          name: resource.name,
          initiatorType: resource.initiatorType,
          transferSize: resource.transferSize,
          encodedBodySize: resource.encodedBodySize,
          decodedBodySize: resource.decodedBodySize,
          dns: resource.domainLookupEnd - resource.domainLookupStart,
          tcp: resource.connectEnd - resource.connectStart,
          tls: resource.secureConnectionStart > 0 ? resource.connectEnd - resource.secureConnectionStart : 0,
          ttfb: resource.responseStart - resource.requestStart,
          download: resource.responseEnd - resource.responseStart,
          total: resource.responseEnd - resource.startTime,
          renderBlocking: (resource as Record<string, unknown>).renderBlockingStatus as string | undefined,
        })
      }
    })
    observer.observe({ type: 'resource', buffered: true })
  }

  observeResource()

  function observeInp(): void {
    let eventObserverFired = false

    function handleEntry(entry: PerformanceEntry): void {
      const eventEntry = entry as PerformanceEventTiming
      push('perf.cwv', {
        metric: 'inp',
        value: eventEntry.duration,
        startTime: eventEntry.startTime,
      })
    }

    // Primary: 'event' observer captures all interactions with full timing
    const eventObserver = new PerformanceObserver((list) => {
      eventObserverFired = true
      for (const entry of list.getEntries()) {
        handleEntry(entry)
      }
    })
    eventObserver.observe({ type: 'event', buffered: true, durationThreshold: 0 } as PerformanceObserverInit)

    // Fallback: 'first-input' captures the first interaction in environments
    // where the 'event' observer does not fire (e.g. headless Chromium with
    // synthetic clicks). Skipped if 'event' observer already produced entries.
    const firstInputObserver = new PerformanceObserver((list) => {
      if (eventObserverFired) return
      for (const entry of list.getEntries()) {
        handleEntry(entry)
      }
    })
    firstInputObserver.observe({ type: 'first-input', buffered: true })
  }

  observeInp()

  function observeLongTask(): void {
    if (!config.longTasks) return
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const attribution = (entry as unknown as { attribution?: Array<{ containerSrc?: string }> }).attribution
        push('perf.long-task', {
          duration: entry.duration,
          startTime: entry.startTime,
          attribution: attribution?.[0]?.containerSrc || 'unknown',
        })
      }
    })
    observer.observe({ type: 'longtask', buffered: true })
  }

  observeLongTask()

  window.__introspect_plugins__ = window.__introspect_plugins__ || {}
  ;(window.__introspect_plugins__ as Record<string, unknown>).performance = {}
})()
