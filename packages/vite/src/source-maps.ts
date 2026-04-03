// @ts-expect-error Missing type declarations for source-map
import { SourceMapConsumer } from 'source-map'
import type { StackFrame } from '@introspection/types'

type RawSourceMap = ConstructorParameters<typeof SourceMapConsumer>[0]
type SourceMapProvider = (file: string) => RawSourceMap | null

export function resolveStackFrame(
  frame: StackFrame,
  getSourceMap: SourceMapProvider
): StackFrame {
  const map = getSourceMap(frame.file)
  if (!map) return frame

  const consumer = new SourceMapConsumer(map as never)
  const pos = consumer.originalPositionFor({ line: frame.line, column: frame.column })
  if (typeof (consumer as any).destroy === 'function') {
    ;(consumer as any).destroy()
  }

  if (!pos.source) return frame

  return {
    functionName: pos.name ?? frame.functionName,
    file: pos.source,
    line: pos.line ?? frame.line,
    column: pos.column ?? frame.column,
  }
}

/** Builds a SourceMapProvider from Vite's module graph */
export function viteSourceMapProvider(
  getModuleById: (id: string) => any
): SourceMapProvider {
  return (file: string) => {
    const mod = getModuleById(file)
    return mod?.transformResult?.map ?? null
  }
}
