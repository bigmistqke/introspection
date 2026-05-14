import { appendFile, mkdir } from 'fs/promises'
import { dirname, isAbsolute, join } from 'path'
import type { IntrospectionReporter, TestEndInfo } from '@introspection/types'

export interface SummaryReporterOptions {
  /** File to append summary lines to. Relative paths resolve against the run directory. */
  outFile: string
  /** Optional projector for the line shape. Defaults to the built-in shape. */
  format?: (info: TestEndInfo) => Record<string, unknown>
}

function defaultFormat(info: TestEndInfo): Record<string, unknown> {
  return {
    titlePath: info.titlePath,
    status: info.status,
    duration: info.duration,
    error: info.error ?? null,
    startedAt: info.startedAt,
    endedAt: info.endedAt,
    eventCount: info.events.length,
  }
}

export function summaryReporter(options: SummaryReporterOptions): IntrospectionReporter {
  const format = options.format ?? defaultFormat
  return {
    name: 'summary',
    onTestEnd(info, ctx) {
      const target = isAbsolute(options.outFile) ? options.outFile : join(ctx.runDir, options.outFile)
      const line = JSON.stringify(format(info)) + '\n'
      ctx.track(async () => {
        await mkdir(dirname(target), { recursive: true })
        await appendFile(target, line)
      })
    },
  }
}
