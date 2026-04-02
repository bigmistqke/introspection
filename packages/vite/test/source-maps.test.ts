import { describe, it, expect } from 'vitest'
import { resolveStackFrame } from '../src/source-maps.js'
import type { StackFrame } from '@introspection/types'

describe('resolveStackFrame', () => {
  it('returns the frame unchanged when no source map is available', () => {
    const frame: StackFrame = { functionName: 'handleClick', file: 'dist/bundle.js', line: 1, column: 5000 }
    const resolved = resolveStackFrame(frame, () => null)
    expect(resolved).toEqual(frame)
  })

  it('resolves a minified position to original source location', () => {
    // A minimal inline source map: maps line 1, col 0 → originalFile.ts line 5, col 3
    const inlineMap = {
      version: 3,
      sources: ['src/originalFile.ts'],
      names: [],
      mappings: 'AAAA',  // encodes: line 0 col 0 → source 0 line 0 col 0
    }
    const frame: StackFrame = { functionName: 'fn', file: 'bundle.js', line: 1, column: 0 }
    const resolved = resolveStackFrame(frame, (_file) => inlineMap)
    expect(resolved.file).toBe('src/originalFile.ts')
    expect(typeof resolved.line).toBe('number')
  })

  it('preserves functionName across resolution', () => {
    const frame: StackFrame = { functionName: 'myFunc', file: 'bundle.js', line: 1, column: 0 }
    const resolved = resolveStackFrame(frame, () => null)
    expect(resolved.functionName).toBe('myFunc')
  })
})
