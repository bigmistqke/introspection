# Future Plugin Possibilities

## Raw Performance Plugins (separate from Lighthouse)

Individual plugins that capture raw browser performance data as trace events, without scoring or auditing. Each would be a standalone `@introspection/plugin-*` package.

- **Core Web Vitals** — `PerformanceObserver` for LCP, CLS, INP entries as trace events
- **Resource Timing** — full resource waterfall (DNS, TCP, TLS, TTFB, download) for every request
- **Long Tasks** — `PerformanceObserver` for long tasks with attribution (script URL, function name)
- **Layout Shifts** — individual layout shift entries with affected element rects via CDP `PerformanceTimeline.enable`
- **Paint Timing** — FP, FCP, LCP element identification and timing breakdown

## Performance Event Processing / Summarization

Post-processing layer that takes raw performance trace events and produces structured diagnostics — e.g. "LCP was 4.2s, LCP element was `<img src="hero.jpg">`, blocked by 3 render-blocking scripts totaling 1.8s". Could be a CLI command or a separate analysis step.
