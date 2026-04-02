import { randomUUID } from 'crypto'
import type { NetworkRequestEvent, NetworkResponseEvent, JsErrorEvent, StackFrame } from '@introspection/types'

function makeId(): string { return `evt-${randomUUID().slice(0, 8)}` }

export function normaliseCdpNetworkRequest(raw: Record<string, unknown>, _sessionId: string, startedAt: number): NetworkRequestEvent {
  const req = (raw.request ?? {}) as Record<string, unknown>
  return {
    id: makeId(),
    type: 'network.request',
    ts: Math.round(((raw.timestamp as number) * 1000) - startedAt),
    source: 'cdp',
    data: {
      url: req.url as string,
      method: req.method as string,
      headers: (req.headers ?? {}) as Record<string, string>,
      postData: req.postData as string | undefined,
    },
  }
}

export function normaliseCdpNetworkResponse(raw: Record<string, unknown>, _sessionId: string, startedAt: number): NetworkResponseEvent {
  const res = (raw.response ?? {}) as Record<string, unknown>
  return {
    id: makeId(),
    type: 'network.response',
    ts: Math.round(((raw.timestamp as number) * 1000) - startedAt),
    source: 'cdp',
    initiator: raw.requestId as string,
    data: {
      requestId: raw.requestId as string,
      url: res.url as string,
      status: res.status as number,
      headers: (res.headers ?? {}) as Record<string, string>,
    },
  }
}

export function normaliseCdpJsError(raw: Record<string, unknown>, _sessionId: string, startedAt: number): JsErrorEvent {
  const details = (raw.exceptionDetails ?? {}) as Record<string, unknown>
  const trace = details.stackTrace as { callFrames: Array<Record<string, unknown>> } | undefined
  const stack: StackFrame[] = (trace?.callFrames ?? []).map(f => ({
    functionName: (f.functionName as string) || '(anonymous)',
    file: f.url as string,
    line: (f.lineNumber as number) + 1,
    column: f.columnNumber as number,
  }))
  return {
    id: makeId(),
    type: 'js.error',
    ts: Math.round(((raw.timestamp as number) * 1000) - startedAt),
    source: 'cdp',
    data: {
      message: details.text as string,
      stack,
    },
  }
}
