#!/usr/bin/env node
import { Command } from 'commander'
import { buildSummary } from './commands/summary.js'
import { formatNetworkTable } from './commands/network.js'
import { formatEvents } from './commands/events.js'
import { formatPlugins } from './commands/plugins.js'
import { runDebug } from './commands/debug.js'
import { runPayloadCommand } from './commands/payload.js'
import { formatRunsTable } from './commands/runs.js'
import { formatTracesTable } from './commands/list.js'
import { fileURLToPath } from 'url'
import { listSkills, detectPlatform, getInstallRoot, installSkills } from './commands/skills.js'
import { createTraceReader, listRuns, listTraces } from '@introspection/read'
import { serve } from '@introspection/serve/node'
import { parseBase, createAdapterFromBase } from './base.js'
import { loadIntrospectConfig } from '@introspection/config'

const BUNDLED_SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url))
const program = new Command()

program.name('introspect').description('Query Playwright test introspection traces').version('0.1.0')
  .option('--base <pathOrUrl>', 'Trace source: a filesystem path or http(s):// URL (default: ./.introspect)')

let cachedBasePromise: Promise<string | undefined> | undefined
async function resolveBaseValue(): Promise<string | undefined> {
  const flag = program.opts().base as string | undefined
  if (flag) return flag
  if (!cachedBasePromise) {
    cachedBasePromise = loadIntrospectConfig({ cwd: process.cwd() })
      .then(config => config?.base)
      .catch(() => undefined)
  }
  return cachedBasePromise
}

async function describeBase(): Promise<string> {
  return (await resolveBaseValue()) ?? './.introspect'
}

async function getAdapter() {
  return createAdapterFromBase(await resolveBaseValue())
}

/** For commands that write to disk (debug) or serve a directory. URL form errors. */
async function getBasePath(): Promise<string> {
  const parsed = parseBase(await resolveBaseValue())
  if (parsed.kind === 'url') {
    throw new Error('This command requires a local --base path; URL form is read-only')
  }
  return parsed.path
}

async function loadTrace(opts: { run?: string; traceId?: string; verbose?: boolean }) {
  return createTraceReader(await getAdapter(), { runId: opts.run, traceId: opts.traceId, verbose: opts.verbose })
}

program
  .command('debug [url]')
  .description('Debug a live page with introspection')
  .option('--serve <path>', 'Serve a local file or directory instead of a URL')
  .option('--config <path>', 'Path to introspect.config.ts')
  .option('--playwright <script>', 'Playwright script to run (file or inline)')
  .option('--verbose', 'Enable verbose debug logging')
  .action(async (url, opts) => {
    try {
      const dir = await getBasePath()
      await runDebug({ url, serve: opts.serve, config: opts.config, playwright: opts.playwright, verbose: opts.verbose, dir })
    } catch (error) {
      console.error(String((error as Error).message ?? error))
      process.exit(1)
    }
  })

program.command('summary')
  .option('--run <id>')
  .option('--trace-id <id>')
  .option('--verbose', 'Enable verbose debug logging')
  .action(async (opts) => {
    const trace = await loadTrace(opts)
    const events = await trace.events.ls()
    const summary = {
      id: trace.id,
      label: trace.meta.label,
      startedAt: trace.meta.startedAt,
      endedAt: trace.meta.endedAt,
    }
    console.log(buildSummary(summary, events))
  })

program.command('network')
  .option('--run <id>')
  .option('--trace-id <id>')
  .option('--failed')
  .option('--url <pattern>')
  .option('--verbose', 'Enable verbose debug logging')
  .action(async (opts) => {
    const trace = await loadTrace(opts)
    const events = await trace.events.ls()
    console.log(formatNetworkTable(events, opts))
  })

program.command('runs')
  .description('List recorded runs')
  .action(async () => {
    const adapter = await getAdapter()
    const runs = await listRuns(adapter)
    if (runs.length === 0) { console.error(`No runs found at '${await describeBase()}'`); process.exit(1) }
    console.log(formatRunsTable(runs))
  })

program.command('list')
  .description('List traces in a run')
  .option('--run <id>', 'Run id (default: latest run)')
  .action(async (opts: { run?: string }) => {
    const adapter = await getAdapter()
    const runs = await listRuns(adapter)
    if (runs.length === 0) { console.error(`No runs found at '${await describeBase()}'`); process.exit(1) }
    if (opts.run && !runs.some(r => r.id === opts.run)) {
      console.error(`Run '${opts.run}' not found at '${await describeBase()}'`); process.exit(1)
    }
    const runId = opts.run ?? runs[0].id
    const traces = await listTraces(adapter, runId)
    if (traces.length === 0) { console.error(`No traces in run '${runId}' at '${await describeBase()}'`); process.exit(1) }
    console.log(formatTracesTable(traces))
  })

program.command('plugins')
  .description('Show plugin metadata for a trace')
  .option('--run <id>')
  .option('--trace-id <id>')
  .option('--verbose', 'Enable verbose debug logging')
  .action(async (opts) => {
    const trace = await loadTrace(opts)
    console.log(formatPlugins(trace.meta))
  })

const skillsCmd = program.command('skills').description('Manage AI skills for this project')

skillsCmd
  .command('list')
  .description('List available skills')
  .option('--verbose', 'Enable verbose debug logging')
  .action(async (opts) => {
    const skills = await listSkills(BUNDLED_SKILLS_DIR)
    if (skills.length === 0) {
      console.error('No skills found. Try reinstalling the introspect package.')
      process.exit(1)
    }
    const maxNameLen = Math.max(...skills.map(skill => skill.name.length))
    for (const skill of skills) {
      console.log(`${skill.name.padEnd(maxNameLen + 2)}${skill.description}`)
    }
  })

skillsCmd
  .command('install')
  .description('Install AI skills into your project')
  .option('--platform <name>', 'Target platform (claude)')
  .option('--dir <path>', 'Override install directory')
  .option('--verbose', 'Enable verbose debug logging')
  .action(async (opts: { platform?: string; dir?: string; verbose?: boolean }) => {
    const cwd = process.cwd()

    if (opts.dir && opts.platform) {
      process.stderr.write('Warning: --platform is ignored when --dir is specified.\n')
    } else if (opts.platform && opts.platform !== 'claude') {
      console.error(`Unknown platform: ${opts.platform}. Supported platforms: claude`)
      process.exit(1)
    }

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

    for (const result of results) {
      if (result.overwritten) process.stderr.write(`Overwriting existing skill: ${result.path}\n`)
      console.log(`Installed ${result.name} → ${result.path}`)
    }
  })

program
  .command('events')
  .description('Filter and transform trace events')
  .option('--run <id>')
  .option('--trace-id <id>')
  .option('--filter <expr>', 'Boolean predicate per event (event), e.g. \'event.metadata.status >= 400\'')
  .option('--format <fmt>', 'Output format: text (default) or json')
  .option('--type <patterns>', 'Comma-separated event types. Supports prefix: "network.*"')
  .option('--after <ms>', 'Keep events after this timestamp (ms)', (v) => parseFloat(v))
  .option('--before <ms>', 'Keep events before this timestamp (ms)', (v) => parseFloat(v))
  .option('--since <label>', 'Keep events after the named mark event')
  .option('--last <n>', 'Keep only the last N events', (v) => parseInt(v, 10))
  .option(
    '--payload <names>',
    'Comma-separated list of payload names to include (repeatable). Note: combining with --filter that references a dropped payload will silently zero-match.',
    (v: string, prev: string[] = []) => prev.concat(v.split(',').map(s => s.trim()).filter(Boolean)),
  )
  .option('--verbose', 'Enable verbose debug logging')
  .action(async (opts) => {
    let trace
    try {
      trace = await loadTrace(opts)
    } catch (error) {
      console.error(String(error))
      process.exit(1)
    }
    try {
      const events = await trace.events.ls()
      const out = await formatEvents(events, opts, trace)
      if (out) console.log(out)
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`)
      process.exit(1)
    }
  })

program.command('payload')
  .description('Print one named payload of one event to stdout')
  .argument('<event-id>')
  .argument('<name>')
  .option('--run <id>')
  .option('--trace-id <id>')
  .option('--verbose', 'Enable verbose debug logging')
  .action(async (eventId: string, name: string, opts) => {
    let trace
    try {
      trace = await loadTrace(opts)
    } catch (error) {
      console.error(String(error))
      process.exit(1)
    }
    try {
      await runPayloadCommand({ eventId, name }, trace, process.stdout)
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`)
      process.exit(1)
    }
  })

const serveCmd = program.command('serve').description('Serve introspection traces over HTTP')
serveCmd
  .option('-p, --port <port>', 'Port to listen on', '3456')
  .option('--prefix <path>', 'URL prefix', '/_introspect')
  .option('--host <address>', 'Host to bind to', '0.0.0.0')
  .action(async (opts: { port: string; prefix: string; host: string }) => {
    try {
      const dir = await getBasePath()
      serve({
        directory: dir,
        port: parseInt(opts.port, 10),
        prefix: opts.prefix,
        host: opts.host,
      })
    } catch (error) {
      console.error(String((error as Error).message ?? error))
      process.exit(1)
    }
  })

program.parseAsync()
