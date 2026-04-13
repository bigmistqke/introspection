import { describe, it, expect } from 'vitest'
import { IntrospectError, CdpError, WriteError, ParseError, PluginError } from '../src/errors.js'

describe('IntrospectError', () => {
  it('sets source and message and preserves cause', () => {
    const cause = new Error('underlying')
    const err = new IntrospectError('cdp', 'boom', cause)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(IntrospectError)
    expect(err.source).toBe('cdp')
    expect(err.message).toBe('boom')
    expect(err.cause).toBe(cause)
    expect(err.name).toBe('IntrospectError')
  })
})

describe('CdpError', () => {
  it('prefixes method and extends IntrospectError', () => {
    const err = new CdpError('Runtime.evaluate', 'session closed')
    expect(err).toBeInstanceOf(IntrospectError)
    expect(err).toBeInstanceOf(CdpError)
    expect(err.source).toBe('cdp')
    expect(err.method).toBe('Runtime.evaluate')
    expect(err.message).toBe('CDP Runtime.evaluate: session closed')
    expect(err.name).toBe('CdpError')
  })
})

describe('WriteError', () => {
  it('prefixes operation', () => {
    const err = new WriteError('append', 'ENOSPC')
    expect(err.source).toBe('write')
    expect(err.operation).toBe('append')
    expect(err.message).toBe('write.append: ENOSPC')
    expect(err.name).toBe('WriteError')
  })
})

describe('ParseError', () => {
  it('prefixes context', () => {
    const err = new ParseError('ndjson:line 42', 'Unexpected token')
    expect(err.source).toBe('parse')
    expect(err.context).toBe('ndjson:line 42')
    expect(err.message).toBe('parse.ndjson:line 42: Unexpected token')
    expect(err.name).toBe('ParseError')
  })
})

describe('PluginError', () => {
  it('prefixes plugin name', () => {
    const err = new PluginError('plugin-network', 'handler for Network.requestWillBeSent threw')
    expect(err.source).toBe('plugin')
    expect(err.pluginName).toBe('plugin-network')
    expect(err.message).toBe('[plugin-network] handler for Network.requestWillBeSent threw')
    expect(err.name).toBe('PluginError')
  })
})
