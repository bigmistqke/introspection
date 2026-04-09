// Browser-side SolidJS reactive state instrumentation script.
// Bundled as IIFE and embedded into index.ts at build time.
// Imports from @solid-devtools/debugger and solid-js are bundled in via noExternal.

import { createRoot } from 'solid-js'
import { useDebugger } from '@solid-devtools/debugger'

type Debugger = ReturnType<typeof useDebugger>

type EventMode = 'stream' | 'trigger' | 'off'

interface Config {
  structureUpdates: EventMode
  nodeUpdates: EventMode
  dependencyGraph: EventMode
}

interface BufferedEvent {
  type: string
  data: unknown
}

interface State {
  structure: unknown | null
  updates: unknown | null
  dgraph: unknown | null
}

// ─── Push helper ─────────────────────────────────────────────────────────────

function push(type: string, data: unknown): void {
  ;(window as unknown as { __introspect_push__: (payload: string) => void }).__introspect_push__(
    JSON.stringify({ type, data })
  )
}

// ─── State ───────────────────────────────────────────────────────────────────

let config: Config | null = null
const eventBuffer: BufferedEvent[] = []

const latestState: State = {
  structure: null,
  updates: null,
  dgraph: null,
}

let debuggerInstance: Debugger | null = null
let detected = false

// ─── Event routing ───────────────────────────────────────────────────────────

type EventCategory = 'structureUpdates' | 'nodeUpdates' | 'dependencyGraph'

function routeEvent(category: EventCategory, type: string, data: unknown): void {
  if (!config) {
    eventBuffer.push({ type, data })
    return
  }

  const mode = config[category]
  if (mode === 'off') return

  if (mode === 'stream') {
    push(type, data)
  }

  // For both stream and trigger, keep the latest state for getState()
  if (category === 'structureUpdates') latestState.structure = data
  else if (category === 'nodeUpdates') latestState.updates = data
  else if (category === 'dependencyGraph') latestState.dgraph = data
}

function flushBuffer(): void {
  if (!config) return

  const buffered = eventBuffer.splice(0, eventBuffer.length)
  for (const entry of buffered) {
    const category = eventTypeToCategory(entry.type)
    if (!category) continue
    routeEvent(category, entry.type, entry.data)
  }
}

function eventTypeToCategory(type: string): EventCategory | null {
  if (type === 'solid.structure') return 'structureUpdates'
  if (type === 'solid.updates') return 'nodeUpdates'
  if (type === 'solid.dgraph') return 'dependencyGraph'
  return null
}

// ─── Debugger initialization ─────────────────────────────────────────────────

function initializeDebugger(): void {
  if (detected) return
  detected = true

  createRoot(() => {
    const instance = useDebugger()
    debuggerInstance = instance

    instance.toggleEnabled(true)

    // Enable dependency graph module eagerly so data is available when config arrives
    instance.emit({ kind: 'ToggleModule', data: { module: 'dgraph', enabled: true } })

    instance.listen((message: { kind: string; data: unknown }) => {
      if (message.kind === 'StructureUpdates') {
        routeEvent('structureUpdates', 'solid.structure', message.data)
      } else if (message.kind === 'NodeUpdates') {
        routeEvent('nodeUpdates', 'solid.updates', message.data)
      } else if (message.kind === 'DgraphUpdate') {
        routeEvent('dependencyGraph', 'solid.dgraph', message.data)
      }
    })

    push('solid.initialized', {})
  })
}

// ─── SolidDevtools$$ detection ───────────────────────────────────────────────

function detectDevtools(): void {
  // Check if already present
  if ((globalThis as Record<string, unknown>).SolidDevtools$$) {
    initializeDebugger()
    return
  }

  // Intercept when it gets set
  let devtoolsValue: unknown = undefined
  Object.defineProperty(globalThis, 'SolidDevtools$$', {
    configurable: true,
    enumerable: true,
    get() {
      return devtoolsValue
    },
    set(value: unknown) {
      devtoolsValue = value
      if (value) {
        initializeDebugger()
      }
    },
  })

  // Timeout fallback: warn if not detected after load + delay
  window.addEventListener('load', () => {
    setTimeout(() => {
      if (!detected) {
        push('solid.warning', {
          message:
            'SolidDevtools$$ was not detected. Ensure solid-devtools is installed and the Solid app is loaded.',
        })
      }
    }, 3000)
  })
}

detectDevtools()

// ─── Public API ──────────────────────────────────────────────────────────────

;(window as unknown as Record<string, unknown>).__introspect_plugins__ =
  (window as unknown as Record<string, unknown>).__introspect_plugins__ || {}
;(
  (window as unknown as Record<string, unknown>).__introspect_plugins__ as Record<string, unknown>
).solid = {
  configure(options: Config): void {
    config = options

    // Enable/disable dgraph module based on config
    if (debuggerInstance) {
      const dgraphEnabled = options.dependencyGraph !== 'off'
      debuggerInstance.emit({
        kind: 'ToggleModule',
        data: { module: 'dgraph', enabled: dgraphEnabled },
      })
    }

    flushBuffer()
  },

  getState(): State {
    return {
      structure: config?.structureUpdates === 'trigger' ? latestState.structure : null,
      updates: config?.nodeUpdates === 'trigger' ? latestState.updates : null,
      dgraph: config?.dependencyGraph === 'trigger' ? latestState.dgraph : null,
    }
  },
}
