#!/usr/bin/env node
import { Command } from 'commander'
import { TraceReader } from './trace-reader.js'
import { buildSummary } from './commands/summary.js'
import { formatNetworkTable } from './commands/network.js'
import { formatEvents } from './commands/events.js'
import { formatPlugins } from './commands/plugins.js'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { listSkills, detectPlatform, getInstallRoot, installSkills } from './commands/skills.js'
import { createSession } from '@introspection/query'

const BUNDLED_SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url))
const program = new Command()

program.name('introspect').description('Query Playwright test introspection traces').version('0.1.0')
  .option('--dir <path>', 'Trace output directory', resolve('.introspect'))

async function loadSession(opts: { session?: string }) {
  const dir = program.opts().dir as string
  return opts.session ? createSession(dir, opts.session) : createSession(dir)
}

program.command('summary').option('--session <id>').action(async (opts) => {
  const session = await loadSession(opts)
  const events = await session.events.ls()
  console.log(buildSummary({ ...session, events }))
})

program.command('network').option('--session <id>').option('--failed').option('--url <pattern>').action(async (opts) => {
  const session = await loadSession(opts)
  const events = await session.events.ls()
  console.log(formatNetworkTable(events, opts))
})

program.command('assets')
  .description('List and display assets')
  .option('--session <id>')
  .argument('[path]', 'Asset path to display')
  .action(async (path, opts) => {
    const baseDir = program.opts().dir as string
    const session = await createSession(baseDir, opts.session)

    if (path) {
      const result = await session.assets.read(path)
      if (typeof result === 'string') {
        console.log(result)
      } else {
        console.log(`image: ${result.path} (${result.sizeKB.toFixed(1)}KB)`)
      }
    } else {
      const assets = await session.assets.ls()
      if (assets.length === 0) {
        console.log('(no assets found)')
        return
      }
      for (const a of assets) {
        console.log(a.data.path)
      }
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

program.command('plugins').description('Show plugin metadata for a session').option('--session <id>').action(async (opts) => {
  const session = await loadSession(opts)
  const sessionMeta = { id: session.id, version: '2' as const }
  console.log(formatPlugins(sessionMeta))
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
  .action(async (opts: { platform?: string; dir?: string }) => {
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
  .option('--session <id>')
  .option('--filter <expr>', 'Boolean predicate per event (event), e.g. \'event.data.status >= 400\'')
  .option('--format <fmt>', 'Output format: text (default) or json')
  .option('--type <types>', 'Comma-separated event types to include')
  .option('--source <source>', 'Filter by source: cdp, agent, plugin, playwright')
  .option('--after <ms>', 'Keep events after this timestamp (ms)', (v) => parseFloat(v))
  .option('--before <ms>', 'Keep events before this timestamp (ms)', (v) => parseFloat(v))
  .option('--since <label>', 'Keep events after the named mark event')
  .option('--last <n>', 'Keep only the last N events', (v) => parseInt(v, 10))
  .action(async (opts) => {
    let session
    try {
      session = await loadSession(opts)
    } catch (error) {
      console.error(String(error))
      process.exit(1)
    }
    try {
      const events = await session.events.ls()
      const out = formatEvents(events, opts)
      if (out) console.log(out)
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`)
      process.exit(1)
    }
  })

program.parseAsync()
