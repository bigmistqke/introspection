#!/usr/bin/env node
import { Command } from 'commander'
import { TraceReader } from './trace-reader.js'
import { buildSummary } from './commands/summary.js'
import { formatTimeline } from './commands/timeline.js'
import { formatErrors } from './commands/errors.js'
import { formatVars } from './commands/vars.js'
import { formatNetworkTable } from './commands/network.js'
import { queryBody } from './commands/body.js'
import { formatDom } from './commands/dom.js'
import { evalExpression } from './commands/eval.js'
import { resolve } from 'path'

const DEFAULT_OUT_DIR = resolve('.introspect')
const program = new Command()

program.name('introspect').description('Query Playwright test introspection traces').version('0.1.0')

async function loadTrace(opts: { trace?: string }) {
  const r = new TraceReader(DEFAULT_OUT_DIR)
  return opts.trace ? r.load(opts.trace) : r.loadLatest()
}

program.command('summary').option('--trace <name>').action(async (opts) => {
  const trace = await loadTrace(opts)
  console.log(buildSummary(trace))
})

program.command('timeline').option('--trace <name>').action(async (opts) => {
  const trace = await loadTrace(opts)
  console.log(formatTimeline(trace))
})

program.command('errors').option('--trace <name>').action(async (opts) => {
  const trace = await loadTrace(opts)
  console.log(formatErrors(trace))
})

program.command('vars').option('--trace <name>').option('--at <point>').action(async (opts) => {
  const trace = await loadTrace(opts)
  console.log(formatVars(trace))
})

program.command('network').option('--trace <name>').option('--failed').option('--url <pattern>').action(async (opts) => {
  const trace = await loadTrace(opts)
  console.log(formatNetworkTable(trace.events, opts))
})

program.command('dom').option('--trace <name>').action(async (opts) => {
  const trace = await loadTrace(opts)
  console.log(formatDom(trace))
})

program.command('body <eventId>').option('--path <jsonpath>').option('--jq <expr>').action(async (eventId, opts) => {
  const r = new TraceReader(DEFAULT_OUT_DIR)
  const raw = await r.readBody(eventId)
  if (!raw) { console.error(`No body found for event ${eventId}`); process.exit(1) }
  console.log(queryBody(raw, { path: opts.path }))
})

program.command('eval <expression>').action(async (expression) => {
  const result = await evalExpression(expression, DEFAULT_OUT_DIR)
  console.log(result)
})

program.parseAsync()
