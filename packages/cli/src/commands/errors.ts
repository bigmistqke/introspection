import type { TraceFile, JsErrorEvent } from '@introspection/types'
import { formatStack } from '../format.js'

export function formatErrors(trace: TraceFile): string {
  const errors = trace.events.filter(event => event.type === 'js.error') as JsErrorEvent[]
  if (!errors.length) return '(no JS errors recorded)'
  return errors.map(error =>
    `${error.data.message}\n${formatStack(error.data.stack)}`
  ).join('\n\n')
}
