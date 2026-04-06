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
    const evt = normaliseCdpNetworkRequest(raw, 0)
    expect(evt.type).toBe('network.request')
    expect(evt.source).toBe('cdp')
    expect(evt.data.url).toBe('https://api.example.com/users')
    expect(evt.data.method).toBe('POST')
    expect(evt.data.postData).toBe('{"name":"alice"}')
    expect(evt.id).toBeTruthy()
    expect(evt.ts).toBe(100000)
  })

  it('omits postData when absent', () => {
    const raw = { requestId: 'req-2', request: { url: '/health', method: 'GET', headers: {} }, timestamp: 50 }
    const evt = normaliseCdpNetworkRequest(raw, 0)
    expect(evt.data.postData).toBeUndefined()
  })

  it('normalises a Network.responseReceived event', () => {
    const raw = {
      requestId: 'req-1',
      response: { url: 'https://api.example.com/users', status: 201, headers: { 'content-type': 'application/json' } },
      timestamp: 150,
    }
    const evt = normaliseCdpNetworkResponse(raw, 0)
    expect(evt.type).toBe('network.response')
    expect(evt.data.status).toBe(201)
    expect(evt.initiator).toBe('req-1')
    expect(evt.ts).toBe(150000)
  })

  it('normalises a Runtime.exceptionThrown event', () => {
    const raw = {
      timestamp: 200,
      exceptionDetails: {
        text: 'TypeError',
        stackTrace: { callFrames: [{ functionName: 'handleSubmit', url: 'bundle.js', lineNumber: 0, columnNumber: 5000 }] }
      }
    }
    const evt = normaliseCdpJsError(raw, 0)
    expect(evt.type).toBe('js.error')
    expect(evt.data.stack[0].line).toBe(1)
    expect(evt.ts).toBe(200000)
  })

  it('uses (anonymous) for empty functionName', () => {
    const raw = { timestamp: 300, exceptionDetails: { text: 'Error', stackTrace: { callFrames: [{ functionName: '', url: 'app.js', lineNumber: 9, columnNumber: 0 }] } } }
    const evt = normaliseCdpJsError(raw, 0)
    expect(evt.data.stack[0].functionName).toBe('(anonymous)')
  })

  it('subtracts startedAt from ts', () => {
    const raw = { requestId: 'req-3', request: { url: '/api', method: 'GET', headers: {} }, timestamp: 100 }
    const evt = normaliseCdpNetworkRequest(raw, 5000)
    expect(evt.ts).toBe(95000)
  })

  it('produces ts=0 when timestamp is missing', () => {
    const raw = { exceptionDetails: { text: 'Error' } }
    const evt = normaliseCdpJsError(raw, 0)
    expect(evt.ts).toBe(0)
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
    const evt = normaliseCdpJsError(raw, 0)
    expect(evt.data.message).toBe('TypeError: Cannot read properties of undefined (reading "foo")')
  })
})
