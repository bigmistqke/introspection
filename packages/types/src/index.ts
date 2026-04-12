import type { Page } from '@playwright/test'

// ─── Event types ────────────────────────────────────────────────────────────

export type EventSource = 'cdp' | 'agent' | 'playwright' | 'plugin'

export interface BaseEvent {
  id: string
  timestamp: number   // ms since test start
  source: EventSource
  initiator?: string  // id of event that caused this one (best-effort)
  pageId?: string     // identifies which page emitted this event
  assets?: AssetRef[] // files written to the assets directory by this event
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
  data: Record<string, never>
}

// ─── Asset data map ─────────────────────────────────────────────────────────
//
// Augmentable map of asset kind strings to their typed data shapes.
// `kind` identifies what produced the asset. `contentType` identifies
// the content format for reading/rendering.
//
// Third-party plugins can augment this via declaration merging:
//
//   declare module '@introspection/types' {
//     interface AssetDataMap {
//       'my-capture': { path: string; size?: number; contentType: 'image' }
//     }
//   }

export type AssetContentType = 'json' | 'html' | 'text' | 'image' | 'binary'

export interface AssetDataMap {
  'body': { path: string; size?: number; contentType: 'json' | 'html' | 'text'; summary?: BodySummary; url?: string }
  'screenshot': { path: string; size?: number; contentType: 'image'; viewport?: { width: number; height: number } }
  'snapshot': { path: string; size?: number; contentType: 'json'; trigger?: string; url?: string; scopeCount?: number }
  'scopes': { path: string; size?: number; contentType: 'json' }
  'solid-structure': { path: string; size?: number; contentType: 'json' }
  'solid-dgraph': { path: string; size?: number; contentType: 'json' }
  'solid-updates': { path: string; size?: number; contentType: 'json' }
  'webgl-state': { path: string; size?: number; contentType: 'json' }
  'webgl-canvas': { path: string; size?: number; contentType: 'image' }
}

export type AssetRef = { [K in keyof AssetDataMap]: { kind: K } & AssetDataMap[K] }[keyof AssetDataMap]

export interface PageAttachEvent extends BaseEvent {
  type: 'page.attach'
  data: { pageId: string }
}

export interface PageDetachEvent extends BaseEvent {
  type: 'page.detach'
  data: { pageId: string }
}

export interface DescribeStartEvent extends BaseEvent {
  type: 'describe.start'
  data: { label: string }
}

export interface DescribeEndEvent extends BaseEvent {
  type: 'describe.end'
  data: { label: string }
}

export interface TestStartEvent extends BaseEvent {
  type: 'test.start'
  data: { label: string; titlePath: string[] }
}

export interface TestEndEvent extends BaseEvent {
  type: 'test.end'
  data: { label: string; titlePath: string[]; status: string; duration?: number; error?: string }
}

// ─── Plugin events: network ─────────────────────────────────────────────────

export interface NetworkRequestEvent extends BaseEvent {
  type: 'network.request'
  data: { cdpRequestId: string; cdpTimestamp: number; cdpWallTime: number; url: string; method: string; headers: Record<string, string>; postData?: string }
}

export interface NetworkResponseEvent extends BaseEvent {
  type: 'network.response'
  data: {
    cdpRequestId: string
    cdpTimestamp: number
    requestId: string
    url: string
    status: number
    headers: Record<string, string>
    bodyRef?: string
    bodySummary?: BodySummary
  }
}

export interface NetworkErrorEvent extends BaseEvent {
  type: 'network.error'
  data: { url: string; errorText: string }
}

// ─── Plugin events: js-error ────────────────────────────────────────────────

export interface JsErrorEvent extends BaseEvent {
  type: 'js.error'
  data: { cdpTimestamp: number; message: string; stack: StackFrame[] }
}

// ─── Plugin events: console ─────────────────────────────────────────────────

export type ConsoleLevel = 'log' | 'warn' | 'error' | 'info' | 'debug'

export interface ConsoleEvent extends BaseEvent {
  type: 'console'
  data: { level: ConsoleLevel; message: string }
}

// ─── Plugin events: performance ─────────────────────────────────────────────

export interface PerfCwvEvent extends BaseEvent {
  type: 'perf.cwv'
  data: {
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
  data: {
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
  data: { duration: number; startTime: number; attribution: string }
}

export interface PerfLayoutShiftEvent extends BaseEvent {
  type: 'perf.layout-shift'
  data: {
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
  data: { name: string; startTime: number }
}

// ─── Plugin events: webgl ───────────────────────────────────────────────────

export interface WebGLContextCreatedEvent extends BaseEvent {
  type: 'webgl.context-created'
  data: { contextId: string }
}

export interface WebGLContextLostEvent extends BaseEvent {
  type: 'webgl.context-lost'
  data: { contextId: string }
}

export interface WebGLContextRestoredEvent extends BaseEvent {
  type: 'webgl.context-restored'
  data: { contextId: string }
}

export interface WebGLUniformEvent extends BaseEvent {
  type: 'webgl.uniform'
  data: { contextId: string; name: string; value: unknown; glType: string }
}

export interface WebGLDrawArraysEvent extends BaseEvent {
  type: 'webgl.draw-arrays'
  data: { contextId: string; primitive: string; first: number; count: number }
}

export interface WebGLDrawElementsEvent extends BaseEvent {
  type: 'webgl.draw-elements'
  data: { contextId: string; primitive: string; count: number; indexType: string; offset: number }
}

export interface WebGLTextureBindEvent extends BaseEvent {
  type: 'webgl.texture-bind'
  data: { contextId: string; unit: number; target: string; textureId: number | null }
}

// ─── Plugin events: solid ───────────────────────────────────────────────────

export interface SolidDetectedEvent extends BaseEvent {
  type: 'solid.detected'
  data: Record<string, never>
}

export interface SolidWarningEvent extends BaseEvent {
  type: 'solid.warning'
  data: { message: string }
}

// ─── Plugin events: redux ───────────────────────────────────────────────────

export interface ReduxDispatchEvent extends BaseEvent {
  type: 'redux.dispatch'
  data: { action: string; payload?: unknown; stateBefore?: unknown; stateAfter?: unknown }
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
  'network.error': NetworkErrorEvent
  // JS errors
  'js.error': JsErrorEvent
  // Console
  'console': ConsoleEvent
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
  // Solid
  'solid.detected': SolidDetectedEvent
  'solid.warning': SolidWarningEvent
  // Redux
  'redux.dispatch': ReduxDispatchEvent
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

export interface AssetWriter {
  writeAsset<K extends keyof AssetDataMap>(opts: WriteAssetOptions<K>): Promise<AssetRef>
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
  emit(event: EmitInput): void
  timestamp(): number
  /** Installs a browser-side watch and registers it for navigation recovery. */
  addSubscription(pluginName: string, spec: unknown): Promise<WatchHandle>
  /** Typed async event bus scoped to this session. */
  bus: SessionBus
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

// ─── Shared write types ──────────────────────────────────────────────────────

export type EmitInput = Omit<TraceEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: number }

export type WriteAssetOptions<K extends keyof AssetDataMap = keyof AssetDataMap> = {
  kind: K
  contentType: AssetDataMap[K] extends { contentType: infer C } ? C : AssetContentType
  content: string | Buffer
  ext?: string
  metadata?: Omit<AssetDataMap[K], 'path' | 'size' | 'contentType'>
}

// ─── SessionWriter (returned by createSession()) ────────────────────────────

export interface SessionWriter extends AssetWriter {
  id: string
  emit(event: EmitInput): void
  timestamp(): number
  bus: SessionBus
  finalize(): Promise<void>
}

// ─── SessionReader (returned by query adapters) ─────────────────────────────

export interface EventsFilter {
  type?: string | string[]
  source?: EventSource | EventSource[]
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

export interface AssetsAPI {
  ls(): Promise<AssetRef[]>
  metadata(path: string): Promise<AssetRef | undefined>
  readText(path: string): Promise<string>
  readBinary?(path: string): Promise<ArrayBuffer>
}

export interface SessionReader {
  id: string
  events: EventsAPI
  assets: AssetsAPI
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
  mark(label: string, data?: Record<string, unknown>): void
  emit(event: EmitInput): void
  snapshot(): Promise<void>
  detach(result?: DetachResult): Promise<void>
}
