// Browser-side SolidJS detection and event routing script.
// Bundled as IIFE and embedded into index.ts at build time.
// NO imports from @solid-devtools/debugger — the debugger is injected
// on demand by the server after SolidDevtools$$ is detected.

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

  if (mode === 'trigger') {
    if (category === 'structureUpdates') latestState.structure = data
    else if (category === 'nodeUpdates') latestState.updates = data
    else if (category === 'dependencyGraph') latestState.dgraph = data
  }
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

// ─── SolidDevtools$$ detection ───────────────────────────────────────────────

function onDetected(): void {
  if (detected) return
  detected = true
  // Signal the server to inject the debugger script
  push('solid.detected', {})
}

function detectDevtools(): void {
  if ((globalThis as Record<string, unknown>).SolidDevtools$$) {
    onDetected()
    return
  }

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
        onDetected()
      }
    },
  })

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
    flushBuffer()
  },

  // Called by the injected module script after the debugger is initialized.
  // The debugger v0.23 uses { name, details } instead of { kind, data }.
  onDebuggerReady(instance: { toggleEnabled: (enabled: boolean) => void; emit: (message: unknown) => void; listen: (listener: (message: { name: string; details: unknown }) => void) => () => void }): void {
    instance.toggleEnabled(true)

    instance.listen((message: { name: string; details: unknown }) => {
      if (message.name === 'StructureUpdates') {
        routeEvent('structureUpdates', 'solid.structure', message.details)
      } else if (message.name === 'NodeUpdates') {
        routeEvent('nodeUpdates', 'solid.updates', message.details)
      } else if (message.name === 'DgraphUpdate') {
        routeEvent('dependencyGraph', 'solid.dgraph', message.details)
      }
    })
  },

  getState(): State {
    return {
      structure: config?.structureUpdates === 'trigger' ? latestState.structure : null,
      updates: config?.nodeUpdates === 'trigger' ? latestState.updates : null,
      dgraph: config?.dependencyGraph === 'trigger' ? latestState.dgraph : null,
    }
  },
}
