import type { IntrospectionPlugin, PluginContext, AssetKind } from '@introspection/types'
import { normaliseCdpNetworkRequest, normaliseCdpNetworkResponse } from '@introspection/utils'

export type { NetworkRequestEvent, NetworkResponseEvent, NetworkErrorEvent } from '@introspection/types'

function detectKind(contentTypeHeader: string): AssetKind {
  const ct = contentTypeHeader.toLowerCase()
  if (ct.includes('json')) return 'json'
  if (ct.includes('html')) return 'html'
  if (ct.includes('image')) return 'image'
  if (ct.startsWith('text/')) return 'text'
  return 'binary'
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
            const headerType = (responseEvent.metadata?.headers as Record<string, string> | undefined)?.['content-type'] ?? ''
            const assetKind = detectKind(headerType)
            const asset = await ctx.writeAsset({ kind: assetKind, content: body })
            ctx.emit({ ...responseEvent, assets: [asset] })
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
