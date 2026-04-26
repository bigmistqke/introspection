import { createDebug } from '@introspection/utils'
import type { IntrospectionPlugin, PluginContext, ConsoleLevel } from '@introspection/types'

export type { ConsoleLevel, ConsoleEvent } from '@introspection/types'

export interface ConsoleOptions {
  levels?: ConsoleLevel[]
  verbose?: boolean
}

// CDP Runtime.RemoteObject (subset we care about)
interface RemoteObject {
  type: string
  subtype?: string
  value?: unknown
  unserializableValue?: string
  description?: string
  preview?: ObjectPreview
}
interface ObjectPreview {
  type: string
  subtype?: string
  description?: string
  overflow?: boolean
  properties?: PropertyPreview[]
  entries?: EntryPreview[]
}
interface PropertyPreview {
  name: string
  type: string
  subtype?: string
  value?: string
  valuePreview?: ObjectPreview
}
interface EntryPreview {
  key?: ObjectPreview
  value: ObjectPreview
}

/** Convert one CDP RemoteObject into a JS value. Non-serializable falls back to a string. */
function remoteObjectToValue(o: RemoteObject): unknown {
  if (o.type === 'undefined') return undefined
  if (o.subtype === 'null') return null
  if (o.type === 'string' || o.type === 'number' || o.type === 'boolean') return o.value
  if (o.type === 'bigint' || o.unserializableValue) return o.description ?? String(o.unserializableValue)
  if (o.type === 'function' || o.type === 'symbol') return o.description ?? o.type
  if (o.preview) return previewToValue(o.preview)
  return o.description ?? o.type
}

function previewToValue(p: ObjectPreview): unknown {
  if (p.subtype === 'array') {
    const arr = (p.properties ?? []).map(prop => propertyPreviewToValue(prop))
    return p.overflow ? [...arr, '…'] : arr
  }
  if (p.subtype === 'map' || p.subtype === 'set') {
    return (p.entries ?? []).map(e => (e.key ? [previewToValue(e.key), previewToValue(e.value)] : previewToValue(e.value)))
  }
  const obj: Record<string, unknown> = {}
  for (const prop of p.properties ?? []) obj[prop.name] = propertyPreviewToValue(prop)
  if (p.overflow) obj['…'] = '…'
  return obj
}

function propertyPreviewToValue(p: PropertyPreview): unknown {
  if (p.type === 'undefined') return undefined
  if (p.subtype === 'null') return null
  if (p.type === 'string') return p.value ?? ''
  if (p.type === 'number') return p.value !== undefined ? Number(p.value) : NaN
  if (p.type === 'boolean') return p.value === 'true'
  if (p.valuePreview) return previewToValue(p.valuePreview)
  return p.value ?? p.type
}

export function consolePlugin(options?: ConsoleOptions): IntrospectionPlugin {
  const allowedLevels = options?.levels ?? ['log', 'warn', 'error', 'info', 'debug']
  const debug = createDebug('console', options?.verbose ?? false)

  function normaliseLevel(level: string): ConsoleLevel | undefined {
    if (level === 'warning') return 'warn'
    if (level === 'info' || level === 'debug' || level === 'log' || level === 'error') return level
    return undefined
  }

  return {
    name: 'console',
    description: 'Captures browser console output',
    events: {
      'console': 'Browser console log, warn, error, info, or debug',
    },

    async install(ctx: PluginContext): Promise<void> {
      await ctx.cdpSession.send('Runtime.enable')

      ctx.cdpSession.on('Runtime.consoleAPICalled', (rawParams) => {
        const params = rawParams as { type: string; args: RemoteObject[]; timestamp: number }

        debug('consoleAPICalled', params.type)

        const level = normaliseLevel(params.type)
        if (!level || !allowedLevels.includes(level)) return

        const args = params.args.map(remoteObjectToValue)

        ctx.emit({
          type: 'console',
          timestamp: ctx.timestamp(),
          metadata: { level, args },
        })
      })
    },
  }
}
