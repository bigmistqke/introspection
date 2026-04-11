import type { StackFrame } from '@introspection/types'

function makeId(): string { return `evt-${crypto.randomUUID().slice(0, 8)}` }
function toTimestamp(value: unknown, startedAt: number): number {
  return typeof value === 'number' ? Math.round(value * 1000 - startedAt) : 0
}

export function normaliseCdpNetworkRequest(raw: Record<string, unknown>, startedAt: number) {
  const req = (raw.request ?? {}) as Record<string, unknown>
  return {
    id: makeId(),
    type: 'network.request' as const,
    timestamp: toTimestamp(raw.wallTime ?? raw.timestamp, startedAt),
    source: 'cdp' as const,
    data: {
      cdpRequestId: raw.requestId as string,
      url: req.url as string,
      method: req.method as string,
      headers: (req.headers ?? {}) as Record<string, string>,
      postData: req.postData as string | undefined,
    },
  }
}

export function normaliseCdpNetworkResponse(raw: Record<string, unknown>, startedAt: number, cdpTimeOffset = 0) {
  const response = (raw.response ?? {}) as Record<string, unknown>
  return {
    id: makeId(),
    type: 'network.response' as const,
    timestamp: typeof raw.timestamp === 'number' ? Math.round(raw.timestamp * 1000 + cdpTimeOffset - startedAt) : 0,
    source: 'cdp' as const,
    initiator: raw.requestId as string,
    data: {
      cdpRequestId: raw.requestId as string,
      requestId: raw.requestId as string,
      url: response.url as string,
      status: response.status as number,
      headers: (response.headers ?? {}) as Record<string, string>,
    },
  }
}

export function normaliseCdpJsError(raw: Record<string, unknown>, startedAt: number) {
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
    type: 'js.error' as const,
    timestamp: toTimestamp(raw.timestamp, startedAt),
    source: 'cdp' as const,
    data: { message, stack },
  }
}
