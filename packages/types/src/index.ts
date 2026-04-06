// ─── Event types ────────────────────────────────────────────────────────────

export type EventSource = 'cdp' | 'agent' | 'playwright' | 'plugin'

export interface BaseEvent {
  id: string
  ts: number          // ms since test start
  source: EventSource
  initiator?: string  // id of event that caused this one (best-effort)
}

export interface NetworkRequestEvent extends BaseEvent {
  type: 'network.request'
  data: { cdpRequestId: string; url: string; method: string; headers: Record<string, string>; postData?: string }
}

export interface NetworkResponseEvent extends BaseEvent {
  type: 'network.response'
  data: {
    cdpRequestId: string
    requestId: string
    url: string
    status: number
    headers: Record<string, string>
    bodyRef?: string        // id for sidecar body file
    bodySummary?: BodySummary
  }
}

export interface NetworkErrorEvent extends BaseEvent {
  type: 'network.error'
  data: { url: string; errorText: string }
}

export interface JsErrorEvent extends BaseEvent {
  type: 'js.error'
  data: { message: string; stack: StackFrame[] }
}

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

export interface PlaywrightResultEvent extends BaseEvent {
  type: 'playwright.result'
  data: { status?: 'passed' | 'failed' | 'timedOut' | 'skipped'; duration?: number; error?: string }
}

export interface AssetEvent extends BaseEvent {
  type: 'asset'
  data: {
    path: string
    kind: string
    summary?: BodySummary
    trigger?: string
    url?: string
    scopeCount?: number
  }
}

export interface PluginEvent extends BaseEvent {
  source: 'plugin'
  type: string   // e.g. 'webgl.uniform', 'redux.action'
  data: Record<string, unknown>
}

export type TraceEvent =
  | NetworkRequestEvent
  | NetworkResponseEvent
  | NetworkErrorEvent
  | JsErrorEvent
  | BrowserNavigateEvent
  | MarkEvent
  | PlaywrightActionEvent
  | PlaywrightResultEvent
  | AssetEvent
  | PluginEvent

// ─── Plugin system ────────────────────────────────────────────────────────────

/** Minimal page abstraction. Playwright's Page satisfies this structurally. */
export interface PluginPage {
  evaluate<T>(fn: () => T): Promise<T>
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>
}

export interface CaptureResult {
  kind: string
  content: string | Buffer
  ext?: string
  summary: Record<string, unknown>
}

export interface WatchHandle {
  unwatch(): Promise<void>
}

export interface PluginContext {
  page: PluginPage
  cdpSession: { send(method: string, params?: Record<string, unknown>): Promise<unknown> }
  emit(event: Omit<TraceEvent, 'id' | 'ts'> & { id?: string; ts?: number }): void
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
}

export interface IntrospectionPlugin {
  name: string
  script: string
  install(ctx: PluginContext): Promise<void>
  capture?(trigger: 'js.error' | 'manual' | 'detach', ts: number): Promise<CaptureResult[]>
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
  ts: number
  trigger: 'js.error' | 'manual'
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
}

export interface IntrospectHandle {
  page: import('@playwright/test').Page   // Proxy-wrapped page
  mark(label: string, data?: Record<string, unknown>): void
  snapshot(): Promise<void>
  detach(result?: DetachResult): Promise<void>
}
