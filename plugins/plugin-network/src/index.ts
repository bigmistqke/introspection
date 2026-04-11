import type { IntrospectionPlugin, PluginContext } from '@introspection/types'
import { summariseBody, normaliseCdpNetworkRequest, normaliseCdpNetworkResponse } from '@introspection/utils'

export type { NetworkRequestEvent, NetworkResponseEvent, NetworkErrorEvent } from '@introspection/types'

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

      ctx.cdpSession.on('Network.requestWillBeSent', (rawParams) => {
        ctx.emit(normaliseCdpNetworkRequest(rawParams as Record<string, unknown>))
      })

      const pendingResponses = new Map<string, ReturnType<typeof normaliseCdpNetworkResponse>>()

      ctx.cdpSession.on('Network.responseReceived', (rawParams) => {
        const parameters = rawParams as Record<string, unknown>
        const requestId = (parameters as { requestId: string }).requestId
        pendingResponses.set(requestId, normaliseCdpNetworkResponse(parameters))
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
