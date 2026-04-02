import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { TraceFile, TraceEvent, BodySummary } from '@introspection/types'
import type { Session } from './server.js'

interface TestResult { status: 'passed' | 'failed' | 'timedOut' | 'skipped'; error?: string }

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
}

function summariseBody(raw: string): BodySummary {
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(raw) } catch { return { keys: [], scalars: {}, arrays: {}, errorFields: {} } }

  const keys = Object.keys(parsed)
  const scalars: Record<string, string | number | boolean | null> = {}
  const arrays: Record<string, { length: number; itemKeys: string[] }> = {}
  const errorFields: Record<string, unknown> = {}
  const ERROR_KEYS = new Set(['error', 'message', 'code', 'status', 'detail'])

  for (const [k, v] of Object.entries(parsed)) {
    if (Array.isArray(v)) {
      const first = v[0] && typeof v[0] === 'object' ? Object.keys(v[0] as object) : []
      arrays[k] = { length: v.length, itemKeys: first }
    } else if (ERROR_KEYS.has(k) && (typeof v !== 'object' || v === null)) {
      scalars[k] = v as string | number | boolean | null
    }
    if (ERROR_KEYS.has(k)) errorFields[k] = v
  }

  return { keys, scalars, arrays, errorFields }
}

export async function writeTrace(
  session: Session,
  result: TestResult,
  outDir: string,
  workerIndex: number
): Promise<void> {
  await mkdir(outDir, { recursive: true })

  // Write body sidecar files
  const bodiesDir = join(outDir, 'bodies')
  if (session.bodyMap?.size) {
    await mkdir(bodiesDir, { recursive: true })
    for (const [id, raw] of session.bodyMap) {
      await writeFile(join(bodiesDir, `${id}.json`), raw)
    }
  }

  // Strip raw body from events, add bodySummary
  const events: TraceEvent[] = session.events.map(evt => {
    if (evt.type === 'network.response' && session.bodyMap?.has(evt.id)) {
      const raw = session.bodyMap.get(evt.id)!
      return { ...evt, data: { ...evt.data, bodySummary: summariseBody(raw) } }
    }
    return evt
  })

  const trace: TraceFile = {
    version: '1',
    test: {
      title: session.testTitle,
      file: session.testFile,
      status: result.status,
      duration: Date.now() - session.startedAt,
      error: result.error,
    },
    events,
    snapshots: session.snapshot ? { 'on-error': session.snapshot } : {},
  }

  const filename = `${slugify(session.testTitle)}--w${workerIndex}.trace.json`
  await writeFile(join(outDir, filename), JSON.stringify(trace, null, 2))
}
