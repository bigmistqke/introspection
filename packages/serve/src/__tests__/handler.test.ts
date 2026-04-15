import { describe, it, expect } from 'vitest'
import { createHandler } from '../index.js'
import { resolve } from 'path'

const fixturesDir = resolve(__dirname, './fixtures/introspect')

describe('createHandler', () => {
  it('lists sessions', () => {
    const handler = createHandler({ directory: fixturesDir })
    const response = handler({ url: '/_introspect/' })
    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('application/json')
  })

  it('returns empty array when directory does not exist', () => {
    const handler = createHandler({ directory: '/nonexistent' })
    const response = handler({ url: '/_introspect/' })
    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
  })

  it('returns session meta', () => {
    const handler = createHandler({ directory: fixturesDir })
    const response = handler({ url: '/_introspect/session-1/meta.json' })
    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
  })

  it('returns 404 for missing session', () => {
    const handler = createHandler({ directory: fixturesDir })
    const response = handler({ url: '/_introspect/nonexistent/meta.json' })
    expect(response).not.toBeNull()
    expect(response!.status).toBe(404)
  })

  it('returns events ndjson', () => {
    const handler = createHandler({ directory: fixturesDir })
    const response = handler({ url: '/_introspect/session-1/events.ndjson' })
    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('application/x-ndjson')
  })

  it('returns 400 for streaming endpoint without streaming enabled', () => {
    const handler = createHandler({ directory: fixturesDir, streaming: false })
    const response = handler({ url: '/_introspect/session-1/events' })
    expect(response).not.toBeNull()
    expect(response!.status).toBe(400)
  })
})