// ─── Event types ────────────────────────────────────────────────────────────

export type EventSource = 'cdp' | 'agent' | 'plugin' | 'playwright'

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

/** @unimplemented - not yet emitted by any package */
export interface JsConsoleEvent extends BaseEvent {
  type: 'js.console'
  data: { level: 'log' | 'warn' | 'error' | 'info'; args: unknown[] }
}

/** @unimplemented - not yet emitted by any package */
export interface DomSnapshotEvent extends BaseEvent {
  type: 'dom.snapshot'
  data: {
    url: string
    focusedSelector?: string
    visibleFormElements: Array<{ selector: string; value: string }>
  }
}

/** @unimplemented - not yet emitted by any package */
export interface VariableSnapshotEvent extends BaseEvent {
  type: 'variable.snapshot'
  data: { scopes: ScopeFrame[]; trigger: string }
}

/** @unimplemented - not yet emitted by any package */
export interface BrowserClickEvent extends BaseEvent {
  type: 'browser.click'
  data: { selector: string; text: string; x: number; y: number }
}

/** @unimplemented - not yet emitted by any package */
export interface BrowserInputEvent extends BaseEvent {
  type: 'browser.input'
  data: { selector: string; value: string }
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

export interface PluginEvent extends BaseEvent {
  type: `plugin.${string}`
  data: Record<string, unknown>
}

export type TraceEvent =
  | NetworkRequestEvent
  | NetworkResponseEvent
  | NetworkErrorEvent
  | JsErrorEvent
  | JsConsoleEvent
  | DomSnapshotEvent
  | VariableSnapshotEvent
  | BrowserClickEvent
  | BrowserInputEvent
  | BrowserNavigateEvent
  | MarkEvent
  | PlaywrightActionEvent
  | PluginEvent

// ─── Supporting types ────────────────────────────────────────────────────────

export interface StackFrame {
  functionName: string
  file: string      // always source-mapped
  line: number
  column: number
}

export interface ScopeFrame {
  frame: string           // "functionName (file:line)"
  vars: Record<string, unknown>
}

export interface BodySummary {
  keys: string[]
  scalars: Record<string, string | number | boolean | null>
  arrays: Record<string, { length: number; itemKeys: string[] }>
  errorFields: Record<string, unknown>
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

export interface OnErrorSnapshot {
  ts: number
  trigger: 'js.error' | 'playwright.assertion' | 'manual'
  url: string
  dom: string
  scopes: ScopeFrame[]
  globals: Record<string, unknown>
  plugins: Record<string, unknown>
}

// ─── Trace file ──────────────────────────────────────────────────────────────

export interface TraceTest {
  title: string
  file: string
  status: 'passed' | 'failed' | 'timedOut' | 'skipped'
  duration: number
  error?: string
}

/** Subset of TraceTest passed to detach() — title and file are not needed at teardown time */
export type TestResult = Omit<TraceTest, 'title' | 'file'>

export interface TraceFile {
  version: '1'
  test: TraceTest
  events: TraceEvent[]
  snapshots: { 'on-error'?: OnErrorSnapshot; [key: string]: OnErrorSnapshot | undefined }
}

// ─── Plugin interface ─────────────────────────────────────────────────────────

export interface BrowserAgent {
  emit(event: Omit<PluginEvent, 'id' | 'ts' | 'source'>): void
}

export interface IntrospectionPlugin {
  name: string
  browser?: {
    setup(agent: BrowserAgent): void
    snapshot(): Record<string, unknown>
  }
  server?: {
    transformEvent(event: TraceEvent): TraceEvent | null
    extendSnapshot(snapshot: OnErrorSnapshot): Record<string, unknown>
  }
}

// ─── RPC Protocol interfaces ──────────────────────────────────────────────────

/** Methods the Vite server exposes — called by both Playwright and browser clients. */
export interface IntrospectionServerMethods {
  /** Called by Playwright to register a new test session. */
  startSession(params: { id: string; testTitle: string; testFile: string }): void
  /** Called by Playwright or browser to append an event to a session. */
  event(sessionId: string, event: TraceEvent): void
  /** Called by Playwright at test end to write the trace file and close the session. */
  endSession(sessionId: string, result: TestResult, outDir: string, workerIndex: number): void
  /** Called by browser (or handle.snapshot()) to trigger CDP snapshot capture on the Playwright side. */
  requestSnapshot(sessionId: string, trigger: OnErrorSnapshot['trigger']): void
}

/** Methods Playwright exposes — the server calls these to request snapshot capture. */
export interface PlaywrightClientMethods {
  takeSnapshot(trigger: OnErrorSnapshot['trigger']): Promise<OnErrorSnapshot>
}

/**
 * Browser connections expose no methods the server calls back on.
 * Kept as an explicit type to document the protocol contract and for future extensibility.
 */
export type BrowserClientMethods = Record<never, never>

// ─── Config ───────────────────────────────────────────────────────────────────

export interface CaptureConfig {
  ignore?: string[]
  network?: {
    /** @unimplemented */
    ignoreUrls?: RegExp[]
    /** @unimplemented */
    ignoreHeaders?: string[]
  }
  /** @unimplemented */
  responseBody?: {
    maxSize?: string    // e.g. '50kb'
    ignore?: RegExp[]   // matched against Content-Type first, then URL
  }
}

export interface IntrospectionConfig {
  plugins?: IntrospectionPlugin[]
  capture?: CaptureConfig
  outDir?: string   // output directory for traces and eval socket; default '.introspect'
}

// ─── IntrospectHandle (returned by attach()) ──────────────────────────────────

export interface IntrospectHandle {
  page: import('@playwright/test').Page   // Proxy-wrapped page
  mark(label: string, data?: Record<string, unknown>): void
  snapshot(): Promise<void>
  detach(result?: TestResult): Promise<void>
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function shallowChangedKeys(before: unknown, after: unknown): string[] {
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) return []
  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  const keys = new Set([...Object.keys(b), ...Object.keys(a)])
  return [...keys].filter(k => b[k] !== a[k])
}
