import type { IntrospectionPlugin, PluginContext, BaseEvent, BodySummary } from '@introspection/types'
import { summariseBody, normaliseCdpNetworkRequest, normaliseCdpNetworkResponse } from '@introspection/core'

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
    bodyRef?: string
    bodySummary?: BodySummary
  }
}

export interface NetworkErrorEvent extends BaseEvent {
  type: 'network.error'
  data: { url: string; errorText: string }
}

declare module '@introspection/types' {
  interface TraceEventMap {
    'network.request': NetworkRequestEvent
    'network.response': NetworkResponseEvent
    'network.error': NetworkErrorEvent
  }
}

function detectContentType(body: string, contentTypeHeader: string): 'json' | 'html' | 'text' {
  const ct = contentTypeHeader.toLowerCase()
  if (ct.includes('json') || (body.trimStart().startsWith('{') || body.trimStart().startsWith('['))) return 'json'
  if (ct.includes('html')) return 'html'
  return 'text'
}

export function network(): IntrospectionPlugin {
  return {
    name: 'network',
    description: 'Captures HTTP requests, responses, and response bodies',
    events: {
      'network.request': 'Outgoing HTTP request',
      'network.response': 'HTTP response with optional body summary',
      'network.error': 'Failed or aborted request',
    },

    async install(ctx: PluginContext): Promise<void> {
      await ctx.cdpSession.send('Network.enable')

      // Offset to convert CDP monotonic timestamps (seconds since Chrome start) to wall-clock ms.
      // Computed from the first request's wallTime field and stored for use with response timestamps.
      let cdpTimeOffset = 0

      ctx.cdpSession.on('Network.requestWillBeSent', (rawParams) => {
        const parameters = rawParams as Record<string, unknown>
        const typed = parameters as { wallTime?: number; timestamp?: number }
        if (cdpTimeOffset === 0 && typeof typed.wallTime === 'number' && typeof typed.timestamp === 'number') {
          cdpTimeOffset = Math.round(typed.wallTime * 1000 - typed.timestamp * 1000)
        }
        // Derive startedAt from ctx.timestamp() so that the normalised timestamp is
        // a relative offset from session start, matching what emit() expects.
        const startedAt = Date.now() - ctx.timestamp()
        ctx.emit(normaliseCdpNetworkRequest(parameters, startedAt))
      })

      const pendingResponses = new Map<string, ReturnType<typeof normaliseCdpNetworkResponse>>()

      ctx.cdpSession.on('Network.responseReceived', (rawParams) => {
        const parameters = rawParams as Record<string, unknown>
        const requestId = (parameters as { requestId: string }).requestId
        const startedAt = Date.now() - ctx.timestamp()
        pendingResponses.set(requestId, normaliseCdpNetworkResponse(parameters, startedAt, cdpTimeOffset))
      })

      ctx.cdpSession.on('Network.loadingFinished', (rawParams) => {
        const parameters = rawParams as { requestId: string }
        const responseEvent = pendingResponses.get(parameters.requestId)
        if (!responseEvent) return
        pendingResponses.delete(parameters.requestId)
        void (async () => {
          try {
            const responseBody = await ctx.cdpSession.send('Network.getResponseBody', { requestId: parameters.requestId }) as { body: string; base64Encoded: boolean }
            const body = responseBody.base64Encoded ? Buffer.from(responseBody.body, 'base64').toString('utf-8') : responseBody.body
            const summary = summariseBody(body)
            const contentType = detectContentType(body, (responseEvent.data as { headers?: Record<string, string> }).headers?.['content-type'] ?? '')
            await ctx.writeAsset({ kind: 'body', content: body, metadata: { timestamp: ctx.timestamp(), summary, contentType } })
            ctx.emit({ ...responseEvent, data: { ...responseEvent.data, bodySummary: summary } })
          } catch {
            ctx.emit(responseEvent)
          }
        })()
      })

      ctx.cdpSession.on('Network.loadingFailed', (rawParams) => {
        const parameters = rawParams as { requestId: string }
        const responseEvent = pendingResponses.get(parameters.requestId)
        if (responseEvent) {
          pendingResponses.delete(parameters.requestId)
          ctx.emit(responseEvent)
        }
      })
    },
  }
}
