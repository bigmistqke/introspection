import { randomUUID } from 'crypto'
import type { IntrospectionPlugin, PluginContext, AssetKind } from '@introspection/types'
import { normaliseCdpNetworkRequest, normaliseCdpNetworkResponse, createDebug } from '@introspection/utils'

export type {
  NetworkRequestEvent,
  NetworkResponseEvent,
  NetworkResponseBodyEvent,
  NetworkErrorEvent,
} from '@introspection/types'

export interface NetworkOptions {
  verbose?: boolean
}

function detectKind(contentTypeHeader: string): AssetKind {
  const ct = contentTypeHeader.toLowerCase()
  if (ct.includes('json')) return 'json'
  if (ct.includes('html')) return 'html'
  if (ct.includes('image')) return 'image'
  if (ct.startsWith('text/')) return 'text'
  return 'binary'
}

export function network(options?: NetworkOptions): IntrospectionPlugin {
  const debug = createDebug('plugin-network', options?.verbose ?? false)
  return {
    name: 'network',
    description: 'Captures HTTP requests, responses, and response bodies',
    events: {
      'network.request': 'Outgoing HTTP request',
      'network.response': 'HTTP response headers/status (body in a linked network.response.body event)',
      'network.response.body': 'Response body asset, linked to a network.response via initiator',
      'network.error': 'Failed or aborted request',
    },

    async install(ctx: PluginContext): Promise<void> {
      debug('install: enabling Network domain')
      await ctx.cdpSession.send('Network.enable')

      // Per-request state captured on responseReceived and read on loadingFinished
      // so the body event can link to its response and pick the right asset kind.
      const pending = new Map<string, { responseId: string; contentType: string }>()

      // Outgoing request → emit network.request synchronously.
      ctx.cdpSession.on('Network.requestWillBeSent', (rawParams) => {
        const parameters = rawParams as { requestId: string; request: { url: string } }
        debug('requestWillBeSent', parameters.requestId, parameters.request.url)
        ctx.emit(normaliseCdpNetworkRequest(rawParams as Record<string, unknown>))
      })

      // Response headers received → emit network.response synchronously with a
      // pre-generated id. The body isn't buffered yet; network.response.body
      // will be emitted later from the loadingFinished handler.
      ctx.cdpSession.on('Network.responseReceived', (rawParams) => {
        const parameters = rawParams as Record<string, unknown>
        const cdpRequestId = (parameters as { requestId: string }).requestId
        const responseEvent = normaliseCdpNetworkResponse(parameters)
        const responseId = randomUUID()
        const headers = (responseEvent.metadata?.headers as Record<string, string> | undefined) ?? {}
        const contentType = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? ''
        pending.set(cdpRequestId, { responseId, contentType })
        debug('responseReceived', cdpRequestId, responseEvent.metadata.url)
        ctx.emit({ ...responseEvent, id: responseId })
      })

      // Request finished → body is buffered. Fetch it and emit network.response.body
      // linked to the earlier response via initiator. If loadingFinished never
      // fires (streaming, routed via Fetch.fulfillRequest, some cached responses),
      // no body event is emitted and nothing hangs — there's nothing waiting.
      ctx.cdpSession.on('Network.loadingFinished', (rawParams) => {
        const { requestId } = rawParams as { requestId: string }
        const state = pending.get(requestId)
        if (!state) return
        pending.delete(requestId)
        debug('loadingFinished', requestId)
        ctx.track(async () => {
          try {
            const responseBody = await ctx.cdpSession.send('Network.getResponseBody', { requestId }) as { body: string; base64Encoded: boolean }
            const body = responseBody.base64Encoded
              ? Buffer.from(responseBody.body, 'base64').toString('utf-8')
              : responseBody.body
            const assetKind = detectKind(state.contentType)
            debug('body captured', requestId, 'kind:', assetKind, 'bytes:', body.length)
            const asset = await ctx.writeAsset({ kind: assetKind, content: body })
            ctx.emit({
              type: 'network.response.body',
              initiator: state.responseId,
              metadata: { cdpRequestId: requestId },
              assets: [asset],
            })
          } catch (error) {
            debug('getResponseBody failed', requestId, (error as Error).message)
            // No body event — network.response was already emitted.
          }
        })
      })

      // Request failed/aborted → emit network.error, drop pending state so no
      // body event is attempted.
      ctx.cdpSession.on('Network.loadingFailed', (rawParams) => {
        const { requestId, errorText } = rawParams as { requestId: string; errorText?: string }
        pending.delete(requestId)
        debug('loadingFailed', requestId, errorText)
        ctx.emit({
          type: 'network.error',
          metadata: {
            cdpRequestId: requestId,
            url: '',
            errorText: errorText ?? '',
          },
        })
      })
    },
  }
}
