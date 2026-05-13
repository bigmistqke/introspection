import type { Page, CDPSession } from '@playwright/test'

// ─── Event types ────────────────────────────────────────────────────────────

export interface BaseEvent {
  id: string
  timestamp: number   // ms since test start
  initiator?: string  // id of event that caused this one (best-effort)
  pageId?: string     // identifies which page emitted this event
  /** Named payloads attached to this event. Each is either inline or an asset reference. */
  payloads?: Record<string, PayloadRef>
  summary?: string    // single-line human-readable rendering for terminal output
}

// ─── Core events (emitted by the framework, not plugins) ────────────────────

export interface BrowserNavigateEvent extends BaseEvent {
  type: 'browser.navigate'
  metadata: { from: string; to: string }
}

export interface MarkEvent extends BaseEvent {
  type: 'mark'
  metadata: { label: string; extra?: Record<string, unknown> }
}

export interface PlaywrightActionEvent extends BaseEvent {
  type: 'playwright.action'
  metadata: { method: string; args: unknown[] }
}

export interface PlaywrightTestStartEvent extends BaseEvent {
  type: 'playwright.test.start'
  metadata: { titlePath: string[] }
}

export interface PlaywrightResultEvent extends BaseEvent {
  type: 'playwright.result'
  metadata: { status?: 'passed' | 'failed' | 'timedOut' | 'skipped'; duration?: number; error?: string; titlePath?: string[] }
}

export interface PlaywrightScreenshotEvent extends BaseEvent {
  type: 'playwright.screenshot'
  metadata?: never
}

// ─── Payload reference ──────────────────────────────────────────────────────
//
// A payload is one named piece of data attached to an event. It is either:
//   - inline (the value lives in events.ndjson; implicitly JSON), or
//   - an asset (the value lives in the session's assets/ directory on disk).
//
// `PayloadFormat` describes how the on-disk bytes should be parsed/rendered.

export type PayloadFormat = 'json' | 'html' | 'text' | 'image' | 'binary'

export interface PayloadInline {
  kind: 'inline'
  value: unknown
}

export interface PayloadAsset {
  kind: 'asset'
  format: PayloadFormat
  path: string
  size?: number
}

export type PayloadRef = PayloadInline | PayloadAsset

export interface PageAttachEvent extends BaseEvent {
  type: 'page.attach'
  metadata: { pageId: string }
}

export interface PageDetachEvent extends BaseEvent {
  type: 'page.detach'
  metadata: { pageId: string }
}

export interface DescribeStartEvent extends BaseEvent {
  type: 'describe.start'
  metadata: { label: string }
}

export interface DescribeEndEvent extends BaseEvent {
  type: 'describe.end'
  metadata: { label: string }
}

export interface TestStartEvent extends BaseEvent {
  type: 'test.start'
  metadata: { label: string; titlePath: string[] }
}

export interface TestEndEvent extends BaseEvent {
  type: 'test.end'
  metadata: { label: string; titlePath: string[]; status: string; duration?: number; error?: string }
}

// ─── Plugin events: network ─────────────────────────────────────────────────

export interface NetworkRequestEvent extends BaseEvent {
  type: 'network.request'
  metadata: { cdpRequestId: string; cdpTimestamp: number; cdpWallTime: number; url: string; method: string; headers: Record<string, string>; postData?: string }
}

export interface NetworkResponseEvent extends BaseEvent {
  type: 'network.response'
  metadata: {
    cdpRequestId: string
    cdpTimestamp: number
    requestId: string
    url: string
    status: number
    headers: Record<string, string>
  }
}

export interface NetworkErrorEvent extends BaseEvent {
  type: 'network.error'
  metadata: { cdpRequestId?: string; url: string; errorText: string }
}

export interface NetworkResponseBodyEvent extends BaseEvent {
  type: 'network.response.body'
  metadata: { cdpRequestId: string }
  // body is in payloads.body; initiator points to the network.response event id
}

// ─── Plugin events: js-error ────────────────────────────────────────────────

export interface JsErrorEvent extends BaseEvent {
  type: 'js.error'
  metadata: { cdpTimestamp: number; message: string; stack: StackFrame[] }
}

// ─── Plugin events: console ─────────────────────────────────────────────────

export type ConsoleLevel = 'log' | 'warn' | 'error' | 'info' | 'debug'

export interface ConsoleEvent extends BaseEvent {
  type: 'console'
  metadata: {
    level: ConsoleLevel
    /**
     * The args the page passed to `console.*`. Primitives keep their type;
     * objects/arrays are reconstructed from the CDP preview (one level deep);
     * non-serializable values (functions, symbols) become a descriptive string.
     */
    args: unknown[]
  }
}

// ─── Plugin events: debugger ────────────────────────────────────────────────

export interface DebuggerCaptureEvent extends BaseEvent {
  type: 'debugger.capture'
  metadata?: never
}

// ─── Plugin events: focus ───────────────────────────────────────────────────

export interface ElementInfo {
  tag: string
  id: string | null
  classList: string[]
  testid: string | null
  role: string | null
  accessibleName: string | null
  text: string | null
  selector: string
  shadowPath: string[] | null
  backendNodeId: number | null
}

export type FocusCause =
  | { cause: 'programmatic'; callSite: string }
  | { cause: 'unknown' }

export type FocusChangedEvent = BaseEvent & {
  type: 'focus.changed'
  metadata: {
    target: ElementInfo | null
    previous: ElementInfo | null
    origin?: string
  } & FocusCause
}

// ─── Plugin events: performance ─────────────────────────────────────────────

export interface PerfCwvEvent extends BaseEvent {
  type: 'perf.cwv'
  metadata: {
    metric: 'lcp' | 'cls' | 'inp'
    value: number
    startTime?: number
    element?: string
    url?: string
    size?: number
  }
}

export interface PerfResourceEvent extends BaseEvent {
  type: 'perf.resource'
  metadata: {
    name: string
    initiatorType: string
    transferSize: number
    encodedBodySize: number
    decodedBodySize: number
    dns: number
    tcp: number
    tls: number
    ttfb: number
    download: number
    total: number
    renderBlocking?: string
  }
}

export interface PerfLongTaskEvent extends BaseEvent {
  type: 'perf.long-task'
  metadata: { duration: number; startTime: number; attribution: string }
}

export interface PerfLayoutShiftEvent extends BaseEvent {
  type: 'perf.layout-shift'
  metadata: {
    score: number
    hadRecentInput: boolean
    sources: Array<{
      selector?: string
      previousRect: { x: number; y: number; width: number; height: number }
      currentRect: { x: number; y: number; width: number; height: number }
    }>
  }
}

export interface PerfPaintEvent extends BaseEvent {
  type: 'perf.paint'
  metadata: { name: string; startTime: number }
}

// ─── Plugin events: webgl ───────────────────────────────────────────────────

export interface WebGLContextCreatedEvent extends BaseEvent {
  type: 'webgl.context-created'
  metadata: { contextId: string }
}

export interface WebGLContextLostEvent extends BaseEvent {
  type: 'webgl.context-lost'
  metadata: { contextId: string }
}

export interface WebGLContextRestoredEvent extends BaseEvent {
  type: 'webgl.context-restored'
  metadata: { contextId: string }
}

export interface WebGLUniformEvent extends BaseEvent {
  type: 'webgl.uniform'
  metadata: { contextId: string; name: string; value: unknown; glType: string }
}

export interface WebGLDrawArraysEvent extends BaseEvent {
  type: 'webgl.draw-arrays'
  metadata: { contextId: string; primitive: string; first: number; count: number }
}

export interface WebGLDrawElementsEvent extends BaseEvent {
  type: 'webgl.draw-elements'
  metadata: { contextId: string; primitive: string; count: number; indexType: string; offset: number }
}

export interface WebGLTextureBindEvent extends BaseEvent {
  type: 'webgl.texture-bind'
  metadata: { contextId: string; unit: number; target: string; textureId: number | null }
}

export interface WebGLCaptureEvent extends BaseEvent {
  type: 'webgl.capture'
  metadata: { contextId: string }
}

// ─── Plugin events: solid-devtools ──────────────────────────────────────────

export interface SolidDevtoolsDetectedEvent extends BaseEvent {
  type: 'solid-devtools.detected'
  metadata?: never
}

export interface SolidDevtoolsWarningEvent extends BaseEvent {
  type: 'solid-devtools.warning'
  metadata: { message: string }
}

export interface SolidDevtoolsCaptureEvent extends BaseEvent {
  type: 'solid-devtools.capture'
  metadata?: never
}

// ─── Plugin events: react-scan ──────────────────────────────────────────────

export interface ReactScanRenderEvent extends BaseEvent {
  type: 'react-scan.render'
  metadata: {
    component: string
    phase: string
    duration: number | null
    count: number
    unnecessary: boolean | null
    didCommit: boolean
    forget: boolean
    fps: number
  }
}

export interface ReactScanCommitEvent extends BaseEvent {
  type: 'react-scan.commit'
  metadata: { phase: 'start' | 'finish' }
}

export interface ReactScanReportEvent extends BaseEvent {
  type: 'react-scan.report'
  metadata: {
    report: Record<string, { count: number; time: number; displayName: string | null }> | null
  }
}

export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test'
  path: string
  value?: unknown
  from?: string
}

// ─── Plugin events: redux ───────────────────────────────────────────────────

export interface ReduxSnapshotEvent extends BaseEvent {
  type: 'redux.snapshot'
  payloads: { state: PayloadRef }
  metadata?: never
}

export interface ReduxDispatchEvent extends BaseEvent {
  type: 'redux.dispatch'
  metadata: {
    action: string
    instance?: string
    payload?: unknown
    diff: JsonPatchOperation[]
  }
}

// ─── Plugin events: cookies ─────────────────────────────────────────────────

export interface CookieEntry {
  name: string
  value: string
  domain: string
  path: string
  /** Unix seconds. Absent for session cookies. */
  expires?: number
  httpOnly: boolean
  secure: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  partitionKey?: string
}

export interface CookieWriteEvent extends BaseEvent {
  type: 'cookie.write'
  metadata: {
    operation: 'set' | 'delete'
    source: 'document.cookie' | 'CookieStore'
    origin: string
    name: string
    value?: string
    domain?: string
    path?: string
    expires?: number
    secure?: boolean
    sameSite?: 'Strict' | 'Lax' | 'None'
    raw?: string
  }
}

export interface CookieHttpEvent extends BaseEvent {
  type: 'cookie.http'
  metadata: {
    operation: 'set' | 'delete'
    /** URL of the response that carried the Set-Cookie header. */
    url: string
    /** CDP requestId, joinable to network.response.metadata.cdpRequestId. */
    requestId: string
    name: string
    value?: string
    domain?: string
    path?: string
    expires?: number
    httpOnly?: boolean
    secure?: boolean
    sameSite?: 'Strict' | 'Lax' | 'None'
    raw: string
  }
}

export interface CookieSnapshotEvent extends BaseEvent {
  type: 'cookie.snapshot'
  metadata: {
    trigger: 'install' | 'manual' | 'js.error' | 'detach'
    origin: string
    cookies: CookieEntry[]
  }
}

// ─── Plugin events: indexeddb ───────────────────────────────────────────────

export type IdbTransactionMode = 'readonly' | 'readwrite' | 'versionchange'

export interface IdbDatabaseEvent extends BaseEvent {
  type: 'idb.database'
  metadata: {
    operation: 'open' | 'upgrade' | 'close' | 'delete'
    origin: string
    name: string
    oldVersion?: number
    newVersion?: number
    outcome?: 'success' | 'error' | 'blocked'
    error?: string
  }
}

export interface IdbSchemaEvent extends BaseEvent {
  type: 'idb.schema'
  metadata: {
    operation:
      | 'createObjectStore' | 'deleteObjectStore'
      | 'createIndex' | 'deleteIndex'
    origin: string
    database: string
    objectStore: string
    index?: string
    keyPath?: string | string[] | null
    autoIncrement?: boolean
    unique?: boolean
    multiEntry?: boolean
  }
}

export interface IdbTransactionEvent extends BaseEvent {
  type: 'idb.transaction'
  metadata: {
    operation: 'begin' | 'complete' | 'abort' | 'error'
    origin: string
    database: string
    transactionId: string
    mode: IdbTransactionMode
    objectStoreNames: string[]
    error?: string
  }
}

export interface IdbWriteEvent extends BaseEvent {
  type: 'idb.write'
  metadata: {
    operation: 'add' | 'put' | 'delete' | 'clear'
    origin: string
    database: string
    objectStore: string
    transactionId: string
    key?: unknown
    affectedCount?: number
    outcome: 'success' | 'error'
    error?: string
    requestedAt: number
    completedAt: number
  }
}

export interface IdbReadEvent extends BaseEvent {
  type: 'idb.read'
  metadata: {
    operation:
      | 'get' | 'getAll' | 'getKey' | 'getAllKeys'
      | 'count' | 'openCursor' | 'openKeyCursor'
    origin: string
    database: string
    objectStore: string
    index?: string
    transactionId: string
    query?: unknown
    count?: number
    outcome: 'success' | 'error'
    error?: string
    requestedAt: number
    completedAt: number
  }
}

export interface IdbSnapshotEvent extends BaseEvent {
  type: 'idb.snapshot'
  metadata: {
    trigger: 'install' | 'manual' | 'js.error' | 'detach'
    origin: string
    databases: Array<{
      name: string
      version: number
      objectStores: Array<{
        name: string
        keyPath: string | string[] | null
        autoIncrement: boolean
        indexes: Array<{
          name: string
          keyPath: string | string[]
          unique: boolean
          multiEntry: boolean
        }>
      }>
    }>
  }
}

// ─── Plugin events: web-storage ─────────────────────────────────────────────

export type WebStorageType = 'localStorage' | 'sessionStorage'

export interface WebStorageWriteEvent extends BaseEvent {
  type: 'webStorage.write'
  metadata: {
    storageType: WebStorageType
    operation: 'set' | 'remove' | 'clear'
    origin: string
    key?: string
    oldValue?: string
    newValue?: string
    clearedKeys?: string[]
  }
}

export interface WebStorageReadEvent extends BaseEvent {
  type: 'webStorage.read'
  metadata: {
    storageType: WebStorageType
    origin: string
    key: string
    value: string | null
  }
}

export interface WebStorageSnapshotEvent extends BaseEvent {
  type: 'webStorage.snapshot'
  metadata: {
    trigger: 'install' | 'manual' | 'js.error' | 'detach'
    origin: string
    localStorage?: Record<string, string>
    sessionStorage?: Record<string, string>
  }
}

// ─── Plugin events: cdp ─────────────────────────────────────────────────────

export interface CdpCommandEvent extends BaseEvent {
  type: 'cdp.command'
  metadata: {
    method: string
    params?: Record<string, unknown>
    result?: unknown
    error?: string
    durationMs: number
  }
}

export interface CdpEventEvent extends BaseEvent {
  type: 'cdp.event'
  metadata: {
    method: string
    params?: unknown
  }
}

export interface IntrospectWarningEvent extends BaseEvent {
  type: 'introspect.warning'
  metadata: {
    source: 'cdp' | 'write' | 'parse' | 'plugin'
    pluginName?: string
    method?: string
    message: string
    stack?: string
    cause?: { name: string; message: string }
  }
}

export interface IntrospectDebugEvent extends BaseEvent {
  type: 'introspect.debug'
  metadata: {
    label: string
    message: string
    args: unknown[]
  }
}

// ─── TraceEventMap ──────────────────────────────────────────────────────────
//
// All known event types. Third-party plugins can still augment this
// interface via declaration merging:
//
//   declare module '@introspection/types' {
//     interface TraceEventMap {
//       'my-plugin.event': MyPluginEvent
//     }
//   }

export interface TraceEventMap {
  // Framework
  'browser.navigate': BrowserNavigateEvent
  'mark': MarkEvent
  'playwright.action': PlaywrightActionEvent
  'playwright.test.start': PlaywrightTestStartEvent
  'playwright.result': PlaywrightResultEvent
  'playwright.screenshot': PlaywrightScreenshotEvent
  'page.attach': PageAttachEvent
  'page.detach': PageDetachEvent
  'describe.start': DescribeStartEvent
  'describe.end': DescribeEndEvent
  'test.start': TestStartEvent
  'test.end': TestEndEvent
  // Network
  'network.request': NetworkRequestEvent
  'network.response': NetworkResponseEvent
  'network.response.body': NetworkResponseBodyEvent
  'network.error': NetworkErrorEvent
  // JS errors
  'js.error': JsErrorEvent
  // Console
  'console': ConsoleEvent
  // Debugger
  'debugger.capture': DebuggerCaptureEvent
  // Focus
  'focus.changed': FocusChangedEvent
  // Performance
  'perf.cwv': PerfCwvEvent
  'perf.resource': PerfResourceEvent
  'perf.long-task': PerfLongTaskEvent
  'perf.layout-shift': PerfLayoutShiftEvent
  'perf.paint': PerfPaintEvent
  // WebGL
  'webgl.context-created': WebGLContextCreatedEvent
  'webgl.context-lost': WebGLContextLostEvent
  'webgl.context-restored': WebGLContextRestoredEvent
  'webgl.uniform': WebGLUniformEvent
  'webgl.draw-arrays': WebGLDrawArraysEvent
  'webgl.draw-elements': WebGLDrawElementsEvent
  'webgl.texture-bind': WebGLTextureBindEvent
  'webgl.capture': WebGLCaptureEvent
  // Solid DevTools
  'solid-devtools.detected': SolidDevtoolsDetectedEvent
  'solid-devtools.warning': SolidDevtoolsWarningEvent
  'solid-devtools.capture': SolidDevtoolsCaptureEvent
  // React Scan
  'react-scan.render': ReactScanRenderEvent
  'react-scan.commit': ReactScanCommitEvent
  'react-scan.report': ReactScanReportEvent
  // Redux
  'redux.snapshot': ReduxSnapshotEvent
  'redux.dispatch': ReduxDispatchEvent
  // Cookies
  'cookie.write': CookieWriteEvent
  'cookie.http': CookieHttpEvent
  'cookie.snapshot': CookieSnapshotEvent
  // IndexedDB
  'idb.database': IdbDatabaseEvent
  'idb.schema': IdbSchemaEvent
  'idb.transaction': IdbTransactionEvent
  'idb.write': IdbWriteEvent
  'idb.read': IdbReadEvent
  'idb.snapshot': IdbSnapshotEvent
  // Web storage
  'webStorage.write': WebStorageWriteEvent
  'webStorage.read': WebStorageReadEvent
  'webStorage.snapshot': WebStorageSnapshotEvent
  // CDP trace
  'cdp.command': CdpCommandEvent
  'cdp.event': CdpEventEvent
  // Introspection
  'introspect.warning': IntrospectWarningEvent
  'introspect.debug': IntrospectDebugEvent
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
  'snapshot': { trigger: 'manual' | 'js.error' | 'debugger.paused'; timestamp: number }
  'manual': { trigger: 'manual'; timestamp: number }
  'detach': { trigger: 'detach'; timestamp: number }
  'introspect:warning': { error: { name: string; message: string; source: 'cdp' | 'write' | 'parse' | 'plugin' | 'reporter'; cause?: unknown; stack?: string; pluginName?: string; method?: string; reporterName?: string } }
  'introspect:debug': { label: string; message: string; args: unknown[]; timestamp: number }
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

export interface AssetWriter {
  writeAsset(opts: WriteAssetOptions): Promise<PayloadAsset>
}

export interface SessionBus {
  on<T extends BusTrigger>(trigger: T, handler: (payload: BusPayloadMap[T]) => void | Promise<void>): void
  emit<T extends BusTrigger>(trigger: T, payload: BusPayloadMap[T]): Promise<void>
}

export interface PluginContext extends AssetWriter {
  page: PluginPage
  cdpSession: {
    send(method: string, params?: Record<string, unknown>): Promise<unknown>
    /** Subscribe to a raw CDP event. Call inside install(). */
    on(event: string, handler: (params: unknown) => void): void
  }
  /**
   * Escape hatch for instrumentation plugins (e.g. plugin-cdp) that need to
   * monkey-patch the shared CDPSession. Mutating this object affects every
   * plugin in the session — do not use unless you know what you're doing.
   */
  rawCdpSession: CDPSession
  emit(event: EmitInput): Promise<void>
  timestamp(): number
  /** Installs a browser-side watch and registers it for navigation recovery. */
  addSubscription(pluginName: string, spec: unknown): Promise<WatchHandle>
  /** Typed async event bus scoped to this session. */
  bus: SessionBus
  /** Track an async operation so that flush()/finalize() wait for it. */
  track(operation: () => Promise<unknown>): void
}

export interface IntrospectionPlugin {
  name: string
  description?: string
  events?: Record<string, string>
  options?: Record<string, { description: string; value: unknown }>
  /** Browser-side IIFE script. Optional — not all plugins have browser-side code. */
  script?: string
  install(ctx: PluginContext): Promise<void>
  /**
   * Optional. Returns a short single-line rendering of an event this plugin owns.
   * Called by `attach()` at emit time; the result is persisted into `event.summary`.
   * Return `null` (or `undefined`) for event types this plugin doesn't recognise.
   * Should be cheap — runs once per emit.
   */
  formatEvent?(event: TraceEvent): string | null | undefined
}

/**
 * A plugins field in introspect config: either a flat array (single always-active set)
 * or an object of named presets where `default` is required.
 */
export type PluginSet =
  | IntrospectionPlugin[]
  | ({ default: IntrospectionPlugin[] } & Record<string, IntrospectionPlugin[]>)

/**
 * Shape of `introspect.config.{ts,js,mjs,mts}` default export.
 */
export interface IntrospectConfig {
  plugins?: PluginSet
}

// ─── Reporter system ─────────────────────────────────────────────────────────

export interface TestStartInfo {
  /** Id of the test.start event (matches BaseEvent.id). */
  testId: string
  label: string
  titlePath: string[]
  /** Wall-clock ms-since-session-start. */
  startedAt: number
}

export interface TestEndInfo extends TestStartInfo {
  endedAt: number
  duration?: number
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted'
  error?: string
  /** All events emitted between this test's test.start and test.end (inclusive). */
  events: TraceEvent[]
  /** Every PayloadAsset referenced by events in the slice, flattened in emission order. */
  assets: PayloadAsset[]
}

export interface ReporterContext {
  sessionId: string
  /** Session directory (e.g. `.introspect/<run-id>/<test-id>`). */
  outDir: string
  /** Run directory (e.g. `.introspect/<run-id>`). Defaults to the parent of outDir. */
  runDir: string
  meta: SessionMeta
  /** Convenience writer for reporter outputs. Relative paths resolve against runDir. */
  writeFile(path: string, content: string | Uint8Array): Promise<void>
  /** Track an async operation so finalize() waits for it. */
  track(operation: () => Promise<unknown>): void
}

export interface IntrospectionReporter {
  name: string
  onSessionStart?(ctx: ReporterContext): void | Promise<void>
  onEvent?(event: TraceEvent, ctx: ReporterContext): void | Promise<void>
  onTestStart?(test: TestStartInfo, ctx: ReporterContext): void | Promise<void>
  onTestEnd?(test: TestEndInfo, ctx: ReporterContext): void | Promise<void>
  onSessionEnd?(ctx: ReporterContext): void | Promise<void>
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

// ─── Shared write types ──────────────────────────────────────────────────────

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type EmitInput = DistributiveOmit<TraceEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: number }

export interface WriteAssetOptions {
  format: PayloadFormat
  content: string | ArrayBufferView
  ext?: string
}

// ─── SessionWriter (returned by createSession()) ────────────────────────────

export interface SessionWriter extends AssetWriter {
  id: string
  emit(event: EmitInput): Promise<void>
  timestamp(): number
  bus: SessionBus
  track(operation: () => Promise<unknown>): void
  flush(): Promise<void>
  finalize(): Promise<void>
}

// ─── Storage Adapter ────────────────────────────────────────────────────────────

export interface StorageAdapter {
  listDirectories(): Promise<string[]>
  readText(path: string): Promise<string>
  readBinary(path: string): Promise<Uint8Array>
  readJSON<T = unknown>(path: string): Promise<T>
}

// ─── SessionReader (returned by query adapters) ─────────────────────────────

export interface EventsFilter {
  type?: string | string[]
  since?: number
  until?: number
  initiator?: string
}

export type Watchable<T> =
  (() => Promise<T>) & { watch(): AsyncIterable<T> }

export type WatchableWithFilter<T, F> =
  ((filter: F) => Promise<T>) & { watch(filter: F): AsyncIterable<T> }

export interface EventsAPI {
  ls: Watchable<TraceEvent[]>
  query: WatchableWithFilter<TraceEvent[], EventsFilter>
  push(event: TraceEvent): void
}

export interface SessionReader {
  id: string
  meta: SessionMeta
  events: EventsAPI
  resolvePayload(ref: PayloadRef): Promise<unknown>
}

// ─── IntrospectHandle (returned by attach()) ──────────────────────────────────

export interface DetachResult {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped'
  duration?: number
  error?: string
  titlePath?: string[]
}

export interface IntrospectHandle extends AssetWriter {
  session: SessionWriter
  pageId: string
  page: Page   // Proxy-wrapped page
  emit(event: EmitInput): Promise<void>
  mark(label: string): Promise<void>
  snapshot(): Promise<void>
  flush(): Promise<void>
  detach(result?: DetachResult): Promise<void>
}
