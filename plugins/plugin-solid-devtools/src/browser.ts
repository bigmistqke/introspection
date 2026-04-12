// Browser-side SolidJS detection and event routing script.
// Bundled as IIFE and embedded into index.ts at build time.
// NO imports from @solid-devtools/debugger — the debugger instance is
// created by the user's app via '@introspection/plugin-solid-devtools/setup'
// and exposed on globalThis.__introspect_solid_debugger__.

type EventMode = 'stream' | 'trigger' | 'off'

interface Config {
  structureUpdates: EventMode
  nodeUpdates: EventMode
  dependencyGraph: EventMode
}

interface BufferedEvent {
  type: string
  metadata: unknown
}

interface State {
  structure: unknown | null
  updates: unknown | null
  dgraph: unknown | null
}

// ─── Push helper ─────────────────────────────────────────────────────────────

function push(type: string, metadata: unknown): void {
  ;(window as unknown as { __introspect_push__: (payload: string) => void }).__introspect_push__(
    JSON.stringify({ type, metadata })
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

let debuggerConnected = false

const DEBUGGER_GLOBAL_KEY = '__introspect_solid_debugger__'

// ─── Event routing ───────────────────────────────────────────────────────────

type EventCategory = 'structureUpdates' | 'nodeUpdates' | 'dependencyGraph'

function routeEvent(category: EventCategory, type: string, metadata: unknown): void {
  if (!config) {
    eventBuffer.push({ type, metadata })
    return
  }

  const mode = config[category]
  if (mode === 'off') return

  if (mode === 'stream') {
    push(type, metadata)
  }

  if (mode === 'trigger') {
    if (category === 'structureUpdates') latestState.structure = metadata
    else if (category === 'nodeUpdates') latestState.updates = metadata
    else if (category === 'dependencyGraph') latestState.dgraph = metadata
  }
}

function flushBuffer(): void {
  if (!config) return

  const buffered = eventBuffer.splice(0, eventBuffer.length)
  for (const entry of buffered) {
    const category = eventTypeToCategory(entry.type)
    if (!category) continue
    routeEvent(category, entry.type, entry.metadata)
  }
}

function eventTypeToCategory(type: string): EventCategory | null {
  if (type === 'solid-devtools.structure') return 'structureUpdates'
  if (type === 'solid-devtools.updates') return 'nodeUpdates'
  if (type === 'solid-devtools.dgraph') return 'dependencyGraph'
  return null
}

// ─── Debugger detection ─────────────────────────────────────────────────────
// The setup module (@introspection/plugin-solid-devtools/setup) creates the
// debugger instance and puts it on globalThis[DEBUGGER_GLOBAL_KEY]. We detect
// it here and wire it into event routing via onDebuggerReady().

function connectDebugger(instance: unknown): void {
  if (debuggerConnected) return

  // Access the public API's onDebuggerReady to wire up event routing
  const solidPlugin = (
    (window as unknown as Record<string, unknown>).__introspect_plugins__ as Record<string, unknown>
  )?.['solid-devtools'] as { onDebuggerReady?: (instance: unknown) => void } | undefined
  if (solidPlugin?.onDebuggerReady) {
    solidPlugin.onDebuggerReady(instance)
  }
}

function detectDebugger(): void {
  // Check if already present (setup module ran before this IIFE)
  const existing = (globalThis as Record<string, unknown>)[DEBUGGER_GLOBAL_KEY]
  if (existing) {
    connectDebugger(existing)
    return
  }

  // Intercept when it gets set (setup module runs after this IIFE)
  let debuggerValue: unknown = undefined
  Object.defineProperty(globalThis, DEBUGGER_GLOBAL_KEY, {
    configurable: true,
    enumerable: true,
    get() {
      return debuggerValue
    },
    set(value: unknown) {
      debuggerValue = value
      if (value) {
        connectDebugger(value)
      }
    },
  })

  window.addEventListener('load', () => {
    setTimeout(() => {
      if (!debuggerConnected) {
        push('solid-devtools.warning', {
          message:
            'Solid debugger was not detected. Ensure @introspection/plugin-solid-devtools/setup is imported in your app entry.',
        } as unknown)
      }
    }, 3000)
  })
}

detectDebugger()

// ─── Public API ──────────────────────────────────────────────────────────────

;(window as unknown as Record<string, unknown>).__introspect_plugins__ =
  (window as unknown as Record<string, unknown>).__introspect_plugins__ || {}
;(
  (window as unknown as Record<string, unknown>).__introspect_plugins__ as Record<string, unknown>
)['solid-devtools'] = {
  configure(options: Config): void {
    config = options
    flushBuffer()
  },

  // Called when the debugger instance is available (either from detectDebugger
  // or from the setup module calling it directly).
  // The debugger v0.23 uses { name, details } message shape.
  onDebuggerReady(instance: { toggleEnabled: (enabled: boolean) => void; emit: (message: unknown) => void; listen: (listener: (message: { name: string; details: unknown }) => void) => () => void }): void {
    if (debuggerConnected) return
    debuggerConnected = true
    push('solid-devtools.detected', {} as unknown)

    instance.toggleEnabled(true)

    instance.listen((message: { name: string; details: unknown }) => {
      if (message.name === 'StructureUpdates') {
        routeEvent('structureUpdates', 'solid-devtools.structure', message.details)
      } else if (message.name === 'NodeUpdates') {
        routeEvent('nodeUpdates', 'solid-devtools.updates', message.details)
      } else if (message.name === 'DgraphUpdate') {
        routeEvent('dependencyGraph', 'solid-devtools.dgraph', message.details)
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
