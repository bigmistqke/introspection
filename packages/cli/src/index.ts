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
import { formatEvents } from './commands/events.js'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { listSkills, detectPlatform, getInstallRoot, installSkills } from './commands/skills.js'

const BUNDLED_SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url))
const program = new Command()

program.name('introspect').description('Query Playwright test introspection traces').version('0.1.0')
  .option('--dir <path>', 'Trace output directory', resolve('.introspect'))

async function loadTrace(opts: { session?: string }) {
  const r = new TraceReader(program.opts().dir as string)
  return opts.session ? r.load(opts.session) : r.loadLatest()
}

program.command('summary').option('--session <id>').action(async (opts) => {
  const trace = await loadTrace(opts)
  console.log(buildSummary(trace))
})

program.command('timeline').option('--session <id>').option('--type <eventType>').option('--source <source>').action(async (opts) => {
  const trace = await loadTrace(opts)
  console.log(formatTimeline(trace, opts))
})

program.command('errors').option('--session <id>').action(async (opts) => {
  const trace = await loadTrace(opts)
  console.log(formatErrors(trace))
})

program.command('vars').option('--session <id>').action(async (opts) => {
  const trace = await loadTrace(opts)
  console.log(formatVars(trace))
})

program.command('network').option('--session <id>').option('--failed').option('--url <pattern>').action(async (opts) => {
  const trace = await loadTrace(opts)
  console.log(formatNetworkTable(trace.events, opts))
})

program.command('dom').option('--session <id>').action(async (opts) => {
  const trace = await loadTrace(opts)
  console.log(formatDom(trace))
})

program.command('body <eventId>')
  .option('--session <id>')
  .option('--path <jsonpath>')
  .option('--jq <expr>')
  .action(async (eventId, opts) => {
    const r = new TraceReader(program.opts().dir as string)
    let sessionId = opts.session
    if (!sessionId) {
      const trace = await r.loadLatest()
      sessionId = trace.session.id
    }
    const raw = await r.readBody(sessionId, eventId)
    if (!raw) { console.error(`No body found for event ${eventId}`); process.exit(1) }
    console.log(queryBody(raw, { path: opts.path }))
  })

program.command('eval <expression>').option('--session <id>').action(async (expression, opts) => {
  const trace = await loadTrace(opts)
  try {
    console.log(evalExpression(trace, expression))
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`)
    process.exit(1)
  }
})

program.command('list').description('List available sessions').action(async () => {
  const dir = program.opts().dir as string
  const r = new TraceReader(dir)
  const sessions = await r.listSessions()
  if (sessions.length === 0) { console.error(`No sessions found in ${dir}`); process.exit(1) }
  const items = await Promise.all(sessions.map(async id => {
    const trace = await r.load(id)
    return { id, trace }
  }))
  items.sort((a, b) => b.trace.session.startedAt - a.trace.session.startedAt)
  for (const { id, trace } of items) {
    const label = trace.session.label ?? id
    const duration = trace.session.endedAt != null
      ? `${trace.session.endedAt - trace.session.startedAt}ms`
      : 'ongoing'
    console.log(`${id.padEnd(40)}  ${duration.padEnd(10)}  ${label}`)
  }
})

const skillsCmd = program.command('skills').description('Manage AI skills for this project')

skillsCmd
  .command('list')
  .description('List available skills')
  .action(async () => {
    const skills = await listSkills(BUNDLED_SKILLS_DIR)
    if (skills.length === 0) {
      console.error('No skills found. Try reinstalling the introspect package.')
      process.exit(1)
    }
    const maxNameLen = Math.max(...skills.map(s => s.name.length))
    for (const s of skills) {
      console.log(`${s.name.padEnd(maxNameLen + 2)}${s.description}`)
    }
  })

skillsCmd
  .command('install')
  .description('Install AI skills into your project')
  .option('--platform <name>', 'Target platform (claude)')
  .option('--dir <path>', 'Override install directory')
  .action(async (opts: { platform?: string; dir?: string }) => {
    const cwd = process.cwd()

    // When --dir is given, --platform is ignored entirely
    if (opts.dir && opts.platform) {
      process.stderr.write('Warning: --platform is ignored when --dir is specified.\n')
    } else if (opts.platform && opts.platform !== 'claude') {
      // Validate explicit --platform only when --dir is not overriding it
      console.error(`Unknown platform: ${opts.platform}. Supported platforms: claude`)
      process.exit(1)
    }

    // Resolve platform
    let platform: 'claude' = 'claude'
    if (!opts.platform && !opts.dir) {
      const detected = await detectPlatform(cwd)
      if ('error' in detected) {
        console.error(detected.error)
        process.exit(1)
      }
      if (!detected.detected) {
        process.stderr.write('No platform detected; defaulting to claude. Use --platform to be explicit.\n')
      }
      platform = detected.platform
    }

    const installRoot = getInstallRoot({ platform, cwd, dir: opts.dir })
    const results = await installSkills(BUNDLED_SKILLS_DIR, installRoot)

    for (const r of results) {
      if (r.overwritten) process.stderr.write(`Overwriting existing skill: ${r.path}\n`)
      console.log(`Installed ${r.name} → ${r.path}`)
    }
  })

program
  .command('events [expression]')
  .description('Filter and transform trace events')
  .option('--session <id>')
  .option('--type <types>', 'Comma-separated event types to include')
  .option('--source <source>', 'Filter by source: cdp, agent, plugin, playwright')
  .option('--after <ms>', 'Keep events after this timestamp (ms)', (v) => parseFloat(v))
  .option('--before <ms>', 'Keep events before this timestamp (ms)', (v) => parseFloat(v))
  .option('--since <label>', 'Keep events after the named mark event')
  .option('--last <n>', 'Keep only the last N events', (v) => parseInt(v, 10))
  .action(async (expression: string | undefined, opts) => {
    let trace
    try {
      trace = await loadTrace(opts)
    } catch (err) {
      console.error(String(err))
      process.exit(1)
    }
    try {
      const out = formatEvents(trace, opts, expression)
      if (out) console.log(out)
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`)
      process.exit(1)
    }
  })

program.parseAsync()
