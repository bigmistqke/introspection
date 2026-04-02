import type { TraceFile, JsErrorEvent } from '@introspection/types'
import { formatStack } from '../format.js'

export function formatErrors(trace: TraceFile): string {
  const errors = trace.events.filter(e => e.type === 'js.error') as JsErrorEvent[]
  if (!errors.length) return '(no JS errors recorded)'
  return errors.map(e =>
    `${e.data.message}\n${formatStack(e.data.stack)}`
  ).join('\n\n')
}
