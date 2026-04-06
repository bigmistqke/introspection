import { describe, it, expect } from 'vitest'
import { normaliseCdpNetworkRequest, normaliseCdpNetworkResponse, normaliseCdpJsError } from '../src/cdp.js'

describe('CDP event normalisation', () => {
  it('normalises a Network.requestWillBeSent event', () => {
    const raw = {
      requestId: 'req-1',
      request: {
        url: 'https://api.example.com/users',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        postData: '{"name":"alice"}',
      },
      timestamp: 100,
    }
    const event = normaliseCdpNetworkRequest(raw, 0)
    expect(event.type).toBe('network.request')
    expect(event.source).toBe('cdp')
    expect(event.data.url).toBe('https://api.example.com/users')
    expect(event.data.method).toBe('POST')
    expect(event.data.postData).toBe('{"name":"alice"}')
    expect(event.id).toBeTruthy()
    expect(event.timestamp).toBe(100000)
  })

  it('omits postData when absent', () => {
    const raw = { requestId: 'req-2', request: { url: '/health', method: 'GET', headers: {} }, timestamp: 50 }
    const event = normaliseCdpNetworkRequest(raw, 0)
    expect(event.data.postData).toBeUndefined()
  })

  it('normalises a Network.responseReceived event', () => {
    const raw = {
      requestId: 'req-1',
      response: { url: 'https://api.example.com/users', status: 201, headers: { 'content-type': 'application/json' } },
      timestamp: 150,
    }
    const event = normaliseCdpNetworkResponse(raw, 0)
    expect(event.type).toBe('network.response')
    expect(event.data.status).toBe(201)
    expect(event.initiator).toBe('req-1')
    expect(event.timestamp).toBe(150000)
  })

  it('normalises a Runtime.exceptionThrown event', () => {
    const raw = {
      timestamp: 200,
      exceptionDetails: {
        text: 'TypeError',
        stackTrace: { callFrames: [{ functionName: 'handleSubmit', url: 'bundle.js', lineNumber: 0, columnNumber: 5000 }] }
      }
    }
    const event = normaliseCdpJsError(raw, 0)
    expect(event.type).toBe('js.error')
    expect(event.data.stack[0].line).toBe(1)
    expect(event.timestamp).toBe(200000)
  })

  it('uses (anonymous) for empty functionName', () => {
    const raw = { timestamp: 300, exceptionDetails: { text: 'Error', stackTrace: { callFrames: [{ functionName: '', url: 'app.js', lineNumber: 9, columnNumber: 0 }] } } }
    const event = normaliseCdpJsError(raw, 0)
    expect(event.data.stack[0].functionName).toBe('(anonymous)')
  })

  it('subtracts startedAt from ts', () => {
    const raw = { requestId: 'req-3', request: { url: '/api', method: 'GET', headers: {} }, timestamp: 100 }
    const event = normaliseCdpNetworkRequest(raw, 5000)
    expect(event.timestamp).toBe(95000)
  })

  it('produces ts=0 when timestamp is missing', () => {
    const raw = { exceptionDetails: { text: 'Error' } }
    const event = normaliseCdpJsError(raw, 0)
    expect(event.timestamp).toBe(0)
  })

  it('normalises with missing request object', () => {
    const raw = { requestId: 'req-x', timestamp: 50 }
    const event = normaliseCdpNetworkRequest(raw, 0)
    expect(event.type).toBe('network.request')
    expect(event.data.url).toBeUndefined()
    expect(event.data.method).toBeUndefined()
  })

  it('normalises with missing response object', () => {
    const raw = { requestId: 'req-x', timestamp: 50 }
    const event = normaliseCdpNetworkResponse(raw, 0)
    expect(event.type).toBe('network.response')
    expect(event.data.url).toBeUndefined()
    expect(event.data.status).toBeUndefined()
  })

  it('truncates stack frames to 5 max is handled by consumer', () => {
    const frames = Array.from({ length: 8 }, (_, i) => ({
      functionName: `fn${i}`, url: 'app.js', lineNumber: i, columnNumber: 0,
    }))
    const raw = { timestamp: 100, exceptionDetails: { text: 'Error', stackTrace: { callFrames: frames } } }
    const event = normaliseCdpJsError(raw, 0)
    // cdp.ts doesn't truncate — it passes all frames through
    expect(event.data.stack).toHaveLength(8)
  })

  it('handles null exception with fallback to details.text', () => {
    const raw = { timestamp: 100, exceptionDetails: { text: 'Uncaught Error', exception: null } }
    const event = normaliseCdpJsError(raw, 0)
    expect(event.data.message).toBe('Uncaught Error')
  })

  it('prefers exception.description over details.text', () => {
    const raw = {
      timestamp: 500,
      exceptionDetails: {
        text: 'Uncaught (in promise)',
        exception: { description: 'TypeError: Cannot read properties of undefined (reading "foo")' },
        stackTrace: { callFrames: [] },
      },
    }
    const event = normaliseCdpJsError(raw, 0)
    expect(event.data.message).toBe('TypeError: Cannot read properties of undefined (reading "foo")')
  })
})
