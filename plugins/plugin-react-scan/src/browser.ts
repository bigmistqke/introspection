import { scan } from 'react-scan'

type Render = {
  phase: number
  componentName: string | null
  time: number | null
  count: number
  unnecessary: boolean | null
}

declare global {
  interface Window {
    __introspect_push__?: (payload: string) => void
  }
}

const push = (event: unknown) => {
  window.__introspect_push__?.(JSON.stringify(event))
}

const PHASE_NAMES: Record<number, string> = { 1: 'mount', 2: 'update', 4: 'unmount' }

scan({
  enabled: true,
  log: false,
  showToolbar: false,
  allowInIframe: true,
  dangerouslyForceRunInProduction: true,
  onCommitStart: () => {
    push({ type: 'react.commit', timestamp: performance.now(), metadata: { phase: 'start' } })
  },
  onRender: (_fiber, renders: Array<Render>) => {
    for (const render of renders) {
      push({
        type: 'react.render',
        timestamp: performance.now(),
        metadata: {
          component: render.componentName ?? 'Anonymous',
          phase: PHASE_NAMES[render.phase] ?? String(render.phase),
          duration: render.time,
          count: render.count,
          unnecessary: render.unnecessary,
        },
      })
    }
  },
  onCommitFinish: () => {
    push({ type: 'react.commit', timestamp: performance.now(), metadata: { phase: 'finish' } })
  },
})
