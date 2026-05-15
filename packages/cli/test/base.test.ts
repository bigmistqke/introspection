import { describe, it, expect } from 'vitest'
import { resolve } from 'path'
import { parseBase, createAdapterFromBase } from '../src/base.js'

describe('parseBase', () => {
  it('defaults to ./.introspect when value is undefined', () => {
    expect(parseBase(undefined)).toEqual({ kind: 'path', path: resolve('./.introspect') })
  })

  it('treats a relative filesystem path as path (resolved)', () => {
    expect(parseBase('./traces')).toEqual({ kind: 'path', path: resolve('./traces') })
  })

  it('treats an absolute filesystem path as path', () => {
    expect(parseBase('/var/tmp/x')).toEqual({ kind: 'path', path: resolve('/var/tmp/x') })
  })

  it('treats http://... as URL', () => {
    expect(parseBase('http://h/_introspect')).toEqual({ kind: 'url', url: 'http://h/_introspect' })
  })

  it('treats https://... as URL', () => {
    expect(parseBase('https://h/_introspect')).toEqual({ kind: 'url', url: 'https://h/_introspect' })
  })

  it('throws on ftp:// (unsupported scheme)', () => {
    expect(() => parseBase('ftp://h/x')).toThrow(/Unsupported URL scheme.*ftp.*--base/)
  })

  it('throws on a typo like htttp:// (unsupported scheme)', () => {
    expect(() => parseBase('htttp://h/x')).toThrow(/Unsupported URL scheme.*htttp.*--base/)
  })

  it('treats a plain word without :// as a relative path', () => {
    expect(parseBase('foo')).toEqual({ kind: 'path', path: resolve('foo') })
  })
})

describe('createAdapterFromBase', () => {
  it('returns a StorageAdapter shape for a path', async () => {
    const adapter = createAdapterFromBase('./does-not-exist')
    expect(typeof adapter.listDirectories).toBe('function')
    expect(typeof adapter.readText).toBe('function')
    expect(typeof adapter.readBinary).toBe('function')
    expect(typeof adapter.readJSON).toBe('function')
  })

  it('returns a StorageAdapter shape for a URL', () => {
    const adapter = createAdapterFromBase('https://h/_introspect')
    expect(typeof adapter.listDirectories).toBe('function')
  })
})
