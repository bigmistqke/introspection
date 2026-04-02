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
      initiator: { type: 'script', stack: { callFrames: [] } },
      timestamp: 100,
    }
    const evt = normaliseCdpNetworkRequest(raw, 'sess-1', 0)
    expect(evt.type).toBe('network.request')
    expect(evt.source).toBe('cdp')
    expect(evt.data.url).toBe('https://api.example.com/users')
    expect(evt.data.method).toBe('POST')
    expect(evt.data.postData).toBe('{"name":"alice"}')
    expect(evt.id).toBeTruthy()
    // ts formula: timestamp(s) * 1000 - startedAt
    expect(evt.ts).toBe(100000)
  })

  it('omits postData when absent', () => {
    const raw = {
      requestId: 'req-2',
      request: { url: 'https://api.example.com/health', method: 'GET', headers: {} },
      timestamp: 50,
    }
    const evt = normaliseCdpNetworkRequest(raw, 'sess-1', 0)
    expect(evt.data.postData).toBeUndefined()
  })

  it('normalises a Network.responseReceived event', () => {
    const raw = {
      requestId: 'req-1',
      response: {
        url: 'https://api.example.com/users',
        status: 201,
        headers: { 'content-type': 'application/json' },
      },
      timestamp: 150,
    }
    const evt = normaliseCdpNetworkResponse(raw, 'sess-1', 0)
    expect(evt.type).toBe('network.response')
    expect(evt.data.status).toBe(201)
    expect(evt.data.requestId).toBe('req-1')
    expect(evt.data.url).toBe('https://api.example.com/users')
    expect(evt.initiator).toBe('req-1')
    expect(evt.ts).toBe(150000)
  })

  it('normalises a Runtime.exceptionThrown event', () => {
    const raw = {
      timestamp: 200,
      exceptionDetails: {
        text: 'TypeError: Cannot read properties of undefined',
        stackTrace: {
          callFrames: [
            { functionName: 'handleSubmit', url: 'bundle.js', lineNumber: 0, columnNumber: 5000 }
          ]
        }
      }
    }
    const evt = normaliseCdpJsError(raw, 'sess-1', 0)
    expect(evt.type).toBe('js.error')
    expect(evt.data.message).toContain('TypeError')
    expect(evt.data.stack).toHaveLength(1)
    expect(evt.data.stack[0].functionName).toBe('handleSubmit')
    // lineNumber is 0-based in CDP → 1-based in our model
    expect(evt.data.stack[0].line).toBe(1)
    expect(evt.ts).toBe(200000)
  })

  it('uses (anonymous) for empty functionName in stack frames', () => {
    const raw = {
      timestamp: 300,
      exceptionDetails: {
        text: 'Error',
        stackTrace: {
          callFrames: [{ functionName: '', url: 'app.js', lineNumber: 9, columnNumber: 0 }]
        }
      }
    }
    const evt = normaliseCdpJsError(raw, 'sess-1', 0)
    expect(evt.data.stack[0].functionName).toBe('(anonymous)')
  })

  it('produces empty stack when stackTrace is missing', () => {
    const raw = {
      timestamp: 400,
      exceptionDetails: { text: 'Error: something went wrong' }
    }
    const evt = normaliseCdpJsError(raw, 'sess-1', 0)
    expect(evt.data.stack).toEqual([])
  })
})
