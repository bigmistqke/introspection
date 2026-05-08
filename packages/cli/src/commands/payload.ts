import type { Writable } from 'stream'
import type { TraceEvent } from '../types.js'
import type { PayloadRef } from '@introspection/types'

interface Reader {
  events: { ls(): Promise<TraceEvent[]> }
  resolvePayload(ref: PayloadRef): Promise<unknown>
}

export interface PayloadCommandOpts {
  eventId: string
  name: string
}

export async function runPayloadCommand(opts: PayloadCommandOpts, reader: Reader, out: Writable): Promise<void> {
  const events = await reader.events.ls()
  const event = events.find(e => e.id === opts.eventId)
  if (!event) throw new Error(`no event with id '${opts.eventId}'`)

  const payloads = event.payloads ?? {}
  const ref = payloads[opts.name]
  if (!ref) {
    const available = Object.keys(payloads).join(', ') || '(none)'
    throw new Error(`event '${opts.eventId}' has no payload named '${opts.name}' (available: ${available})`)
  }

  const value = await reader.resolvePayload(ref)

  if (Buffer.isBuffer(value)) {
    out.write(value)
    return
  }
  if (typeof value === 'string') {
    out.write(value)
    if (!value.endsWith('\n')) out.write('\n')
    return
  }
  out.write(JSON.stringify(value, null, 2) + '\n')
}
