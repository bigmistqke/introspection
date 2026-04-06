import { randomUUID } from 'crypto'
import type { NetworkRequestEvent, NetworkResponseEvent, JsErrorEvent, StackFrame } from '@introspection/types'

function makeId(): string { return `evt-${randomUUID().slice(0, 8)}` }
function toTs(timestamp: unknown, startedAt: number): number {
  return typeof timestamp === 'number' ? Math.round(timestamp * 1000 - startedAt) : 0
}

export function normaliseCdpNetworkRequest(raw: Record<string, unknown>, startedAt: number): NetworkRequestEvent {
  const req = (raw.request ?? {}) as Record<string, unknown>
  return {
    id: makeId(),
    type: 'network.request',
    ts: toTs(raw.timestamp, startedAt),
    source: 'cdp',
    data: {
      cdpRequestId: raw.requestId as string,
      url: req.url as string,
      method: req.method as string,
      headers: (req.headers ?? {}) as Record<string, string>,
      postData: req.postData as string | undefined,
    },
  }
}

export function normaliseCdpNetworkResponse(raw: Record<string, unknown>, startedAt: number): NetworkResponseEvent {
  const res = (raw.response ?? {}) as Record<string, unknown>
  return {
    id: makeId(),
    type: 'network.response',
    ts: toTs(raw.timestamp, startedAt),
    source: 'cdp',
    initiator: raw.requestId as string,
    data: {
      cdpRequestId: raw.requestId as string,
      requestId: raw.requestId as string,
      url: res.url as string,
      status: res.status as number,
      headers: (res.headers ?? {}) as Record<string, string>,
    },
  }
}

export function normaliseCdpJsError(raw: Record<string, unknown>, startedAt: number): JsErrorEvent {
  const details = (raw.exceptionDetails ?? {}) as Record<string, unknown>
  const exception = (details.exception ?? {}) as Record<string, unknown>
  const trace = details.stackTrace as { callFrames: Array<Record<string, unknown>> } | undefined
  const message = (exception.description as string | undefined) ?? (details.text as string)
  const stack: StackFrame[] = (trace?.callFrames ?? []).map(frame => ({
    functionName: (frame.functionName as string) || '(anonymous)',
    file: frame.url as string,
    line: (frame.lineNumber as number) + 1,
    column: frame.columnNumber as number,
  }))
  return {
    id: makeId(),
    type: 'js.error',
    ts: toTs(raw.timestamp, startedAt),
    source: 'cdp',
    data: { message, stack },
  }
}
