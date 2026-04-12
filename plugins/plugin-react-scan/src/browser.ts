import { scan, getReport } from 'react-scan'

type Render = {
  phase: number
  componentName: string | null
  time: number | null
  count: number
  unnecessary: boolean | null
  didCommit: boolean
  forget: boolean
  fps: number
}

declare global {
  interface Window {
    __introspect_push__?: (payload: string) => void
    __introspect_react_scan_report__?: () => unknown
  }
}

const push = (event: unknown) => {
  window.__introspect_push__?.(JSON.stringify(event))
}

const PHASE_NAMES: Record<number, string> = { 1: 'mount', 2: 'update', 4: 'unmount' }

window.__introspect_react_scan_report__ = () => {
  const report = getReport()
  if (!report) return null
  if (report instanceof Map) {
    const entries: Record<string, { count: number; time: number; displayName: string | null }> = {}
    for (const [key, value] of report) {
      entries[key] = { count: value.count, time: value.time, displayName: value.displayName }
    }
    return entries
  }
  const single = report as { count: number; time: number; displayName: string | null }
  return { count: single.count, time: single.time, displayName: single.displayName }
}

scan({
  enabled: true,
  log: false,
  showToolbar: false,
  allowInIframe: true,
  dangerouslyForceRunInProduction: true,
  onCommitStart: () => {
    push({ type: 'react-scan.commit', timestamp: performance.now(), metadata: { phase: 'start' } })
  },
  onRender: (_fiber, renders: Array<Render>) => {
    for (const render of renders) {
      push({
        type: 'react-scan.render',
        timestamp: performance.now(),
        metadata: {
          component: render.componentName ?? 'Anonymous',
          phase: PHASE_NAMES[render.phase] ?? String(render.phase),
          duration: render.time,
          count: render.count,
          unnecessary: render.unnecessary,
          didCommit: render.didCommit,
          forget: render.forget,
          fps: render.fps,
        },
      })
    }
  },
  onCommitFinish: () => {
    push({ type: 'react-scan.commit', timestamp: performance.now(), metadata: { phase: 'finish' } })
  },
})
