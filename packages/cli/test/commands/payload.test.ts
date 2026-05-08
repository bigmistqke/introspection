import { describe, it, expect } from 'vitest'
import { Writable } from 'stream'
import type { PayloadRef } from '@introspection/types'
import { runPayloadCommand } from '../../src/commands/payload.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

type EventStub = {
  id: string
  payloads?: Record<string, PayloadRef>
}

function mockReader(events: EventStub[], files: Record<string, string | Buffer>) {
  return {
    events: {
      ls: async () => events as any[],
    },
    async resolvePayload(ref: PayloadRef): Promise<unknown> {
      if (ref.kind === 'inline') return ref.value
      const content = files[ref.path]
      if (content === undefined) throw new Error(`missing fixture: ${ref.path}`)
      switch (ref.format) {
        case 'json': return JSON.parse(content as string)
        case 'text':
        case 'html': return content as string
        case 'image':
        case 'binary': return content as Buffer
      }
    },
  }
}

function captureStdout() {
  const chunks: Buffer[] = []
  const stream = new Writable({
    write(chunk: Buffer | string, _enc: string, cb: () => void) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      cb()
    },
  })
  return {
    stream,
    text: () => Buffer.concat(chunks).toString('utf-8'),
    bytes: () => Buffer.concat(chunks),
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('payload command', () => {
  it('prints pretty JSON for a json-format asset', async () => {
    const reader = mockReader(
      [{ id: 'e1', payloads: { state: { kind: 'asset', format: 'json', path: 'a.json', size: 17 } } }],
      { 'a.json': '{"user":"alice"}' },
    )
    const writer = captureStdout()
    await runPayloadCommand({ eventId: 'e1', name: 'state' }, reader, writer.stream)
    expect(writer.text()).toBe(JSON.stringify({ user: 'alice' }, null, 2) + '\n')
  })

  it('writes raw bytes for binary payloads', async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const reader = mockReader(
      [{ id: 'e1', payloads: { image: { kind: 'asset', format: 'image', path: 'shot.png', size: 4 } } }],
      { 'shot.png': pngBytes },
    )
    const writer = captureStdout()
    await runPayloadCommand({ eventId: 'e1', name: 'image' }, reader, writer.stream)
    expect(writer.bytes()).toEqual(pngBytes)
  })

  it('prints pretty JSON for an inline value', async () => {
    const reader = mockReader(
      [{ id: 'e1', payloads: { state: { kind: 'inline', value: { theme: 'dark' } } } }],
      {},
    )
    const writer = captureStdout()
    await runPayloadCommand({ eventId: 'e1', name: 'state' }, reader, writer.stream)
    expect(writer.text()).toBe(JSON.stringify({ theme: 'dark' }, null, 2) + '\n')
  })

  it('throws when event id is unknown', async () => {
    const reader = mockReader([], {})
    const writer = captureStdout()
    await expect(runPayloadCommand({ eventId: 'missing', name: 'state' }, reader, writer.stream))
      .rejects.toThrow("no event with id 'missing'")
  })

  it('throws with available names when payload name is unknown', async () => {
    const reader = mockReader(
      [{ id: 'e1', payloads: { state: { kind: 'inline', value: {} } } }],
      {},
    )
    const writer = captureStdout()
    await expect(runPayloadCommand({ eventId: 'e1', name: 'body' }, reader, writer.stream))
      .rejects.toThrow("event 'e1' has no payload named 'body' (available: state)")
  })
})
