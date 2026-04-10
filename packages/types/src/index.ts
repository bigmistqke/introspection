// ─── Event types ────────────────────────────────────────────────────────────

export type EventSource = 'cdp' | 'agent' | 'playwright' | 'plugin'

export interface BaseEvent {
  id: string
  timestamp: number   // ms since test start
  source: EventSource
  initiator?: string  // id of event that caused this one (best-effort)
}

// ─── Core events (emitted by the framework, not plugins) ────────────────────

export interface BrowserNavigateEvent extends BaseEvent {
  type: 'browser.navigate'
  data: { from: string; to: string }
}

export interface MarkEvent extends BaseEvent {
  type: 'mark'
  data: { label: string; extra?: Record<string, unknown> }
}

export interface PlaywrightActionEvent extends BaseEvent {
  type: 'playwright.action'
  data: { method: string; args: unknown[] }
}

export interface PlaywrightTestStartEvent extends BaseEvent {
  type: 'playwright.test.start'
  data: { titlePath: string[] }
}

export interface PlaywrightResultEvent extends BaseEvent {
  type: 'playwright.result'
  data: { status?: 'passed' | 'failed' | 'timedOut' | 'skipped'; duration?: number; error?: string; titlePath?: string[] }
}

export interface PlaywrightScreenshotEvent extends BaseEvent {
  type: 'playwright.screenshot'
  data: { path: string; viewport?: { width: number; height: number } }
}

export interface AssetEvent extends BaseEvent {
  type: 'asset'
  data: {
    path: string
    kind: string
    contentType?: 'json' | 'html' | 'text' | 'image' | 'binary'
    summary?: BodySummary
    trigger?: string
    url?: string
    scopeCount?: number
  }
}

// ─── TraceEventMap ──────────────────────────────────────────────────────────
//
// Augmentable map of event type strings to their typed event interfaces.
// Core declares framework events here. Plugins augment this interface
// from their own packages using declaration merging:
//
//   declare module '@introspection/types' {
//     interface TraceEventMap {
//       'my-plugin.event': MyPluginEvent
//     }
//   }

export interface TraceEventMap {
  'browser.navigate': BrowserNavigateEvent
  'mark': MarkEvent
  'playwright.action': PlaywrightActionEvent
  'playwright.test.start': PlaywrightTestStartEvent
  'playwright.result': PlaywrightResultEvent
  'playwright.screenshot': PlaywrightScreenshotEvent
  'asset': AssetEvent
}

export type TraceEvent = TraceEventMap[keyof TraceEventMap]

// ─── Bus ──────────────────────────────────────────────────────────────────────
//
// Every TraceEvent type is a valid bus trigger — the payload is the event itself.
// ctx.emit() automatically fires on the bus, so any plugin can react to any
// event type without coupling to the emitting plugin.
//
// Lifecycle triggers ('manual', 'detach') have fixed payloads and are bus-only.

export type BusPayloadMap = TraceEventMap & {
  'manual': { trigger: 'manual'; timestamp: number }
  'detach': { trigger: 'detach'; timestamp: number }
}

export type BusTrigger = keyof BusPayloadMap

// ─── Plugin system ────────────────────────────────────────────────────────────

/** Minimal page abstraction. Playwright's Page satisfies this structurally. */
export interface PluginPage {
  evaluate<T>(fn: () => T): Promise<T>
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>
}

export interface WatchHandle {
  unwatch(): Promise<void>
}

export interface PluginContext {
  page: PluginPage
  cdpSession: {
    send(method: string, params?: Record<string, unknown>): Promise<unknown>
    /** Subscribe to a raw CDP event. Call inside install(). */
    on(event: string, handler: (params: unknown) => void): void
  }
  emit(event: Omit<TraceEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: number }): void
  writeAsset(opts: {
    kind: string
    content: string | Buffer
    ext?: string
    metadata: { timestamp: number; [key: string]: unknown }
    source?: EventSource
  }): Promise<string>
  timestamp(): number
  /** Installs a browser-side watch and registers it for navigation recovery. */
  addSubscription(pluginName: string, spec: unknown): Promise<WatchHandle>
  /** Typed async event bus scoped to this session. */
  bus: {
    on<T extends BusTrigger>(
      trigger: T,
      handler: (payload: BusPayloadMap[T]) => void | Promise<void>
    ): void
    emit<T extends BusTrigger>(trigger: T, payload: BusPayloadMap[T]): Promise<void>
  }
}

export interface IntrospectionPlugin {
  name: string
  description?: string
  events?: Record<string, string>
  options?: Record<string, { description: string; value: unknown }>
  /** Browser-side IIFE script. Optional — not all plugins have browser-side code. */
  script?: string
  install(ctx: PluginContext): Promise<void>
}

// ─── Supporting types ────────────────────────────────────────────────────────

export interface StackFrame {
  functionName: string
  file: string      // always source-mapped
  line: number
  column: number
}

export interface ScopeFrame {
  frame: string           // "functionName (file:line)"
  locals: Record<string, unknown>
}

export interface BodySummary {
  keys: string[]
  scalars: Record<string, string | number | boolean | null>
  arrays: Record<string, { length: number; itemKeys: string[] }>
  errorFields: Record<string, unknown>
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

export interface Snapshot {
  timestamp: number
  trigger: 'js.error' | 'debugger.paused' | 'manual'
  url: string
  dom: string
  scopes: ScopeFrame[]
  globals: Record<string, unknown>
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface SessionMeta {
  version: '2'
  id: string
  startedAt: number    // unix ms
  endedAt?: number     // unix ms, set when session ends
  label?: string       // human-readable name
  plugins?: PluginMeta[]
}

export interface PluginMeta {
  name: string
  description?: string
  events?: Record<string, string>
  options?: Record<string, { description: string; value: unknown }>
}

export interface TraceFile {
  version: '2'
  session: Omit<SessionMeta, 'version'>
  events: TraceEvent[]
  snapshots: Snapshot[]
}

// ─── IntrospectHandle (returned by attach()) ──────────────────────────────────

export interface DetachResult {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped'
  duration?: number
  error?: string
  titlePath?: string[]
}

export interface IntrospectHandle {
  page: import('@playwright/test').Page   // Proxy-wrapped page
  mark(label: string, data?: Record<string, unknown>): void
  emit(event: Omit<TraceEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: number }): void
  writeAsset(opts: {
    kind: string
    content: string | Buffer
    ext?: string
    metadata: { timestamp: number; [key: string]: unknown }
    source?: EventSource
  }): Promise<string>
  snapshot(): Promise<void>
  detach(result?: DetachResult): Promise<void>
}
