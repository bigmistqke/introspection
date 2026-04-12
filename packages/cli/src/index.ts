#!/usr/bin/env node
import { Command } from 'commander'
import { buildSummary } from './commands/summary.js'
import { formatNetworkTable } from './commands/network.js'
import { formatEvents } from './commands/events.js'
import { formatPlugins } from './commands/plugins.js'
import { runDebug } from './commands/debug.js'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { listSkills, detectPlatform, getInstallRoot, installSkills } from './commands/skills.js'
import { createSessionReader, listSessions } from '@introspection/read/node'

const BUNDLED_SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url))
const program = new Command()

program.name('introspect').description('Query Playwright test introspection traces').version('0.1.0')
  .option('--dir <path>', 'Trace output directory', resolve('.introspect'))

async function loadSession(opts: { sessionId?: string }) {
  const dir = program.opts().dir as string
  return createSessionReader(dir, opts)
}

program
  .command('debug [url]')
  .description('Debug a live page with introspection')
  .option('--serve <path>', 'Serve a local file or directory instead of a URL')
  .option('--config <path>', 'Path to introspect.config.ts', './introspect.config.ts')
  .option('--playwright <script>', 'Playwright script to run (file or inline)')
  .action(async (url, opts) => {
    const dir = program.opts().dir as string
    await runDebug({ url, serve: opts.serve, config: opts.config, playwright: opts.playwright, dir })
  })

program.command('summary').option('--session-id <id>').action(async (opts) => {
  const session = await loadSession(opts)
  const events = await session.events.ls()
  const summary = {
    id: session.id,
    label: session.meta.label,
    startedAt: session.meta.startedAt,
    endedAt: session.meta.endedAt,
  }
  console.log(buildSummary(summary, events))
})

program.command('network').option('--session-id <id>').option('--failed').option('--url <pattern>').action(async (opts) => {
  const session = await loadSession(opts)
  const events = await session.events.ls()
  console.log(formatNetworkTable(events, opts))
})

program.command('assets')
  .description('List and display assets')
  .option('--session-id <id>')
  .argument('[path]', 'Asset path to display')
  .action(async (path, opts) => {
    const baseDir = program.opts().dir as string
    const session = await createSessionReader(baseDir, opts)

    if (path) {
      const asset = await session.assets.metadata(path)

      if (asset?.kind === 'image') {
        console.log(`image: ${path}${asset.size ? ` (${(asset.size / 1024).toFixed(1)}KB)` : ''}`)
      } else {
        const content = await session.assets.readText(path)
        console.log(content)
      }
    } else {
      const assets = await session.assets.ls()
      if (assets.length === 0) {
        console.log('(no assets found)')
        return
      }
      for (const asset of assets) {
        console.log(`${asset.kind.padEnd(8)} ${asset.path}`)
      }
    }
  })

program.command('list').description('List available sessions').action(async () => {
  const dir = program.opts().dir as string
  const sessions = await listSessions(dir)
  if (sessions.length === 0) { console.error(`No sessions found in ${dir}`); process.exit(1) }
  for (const session of sessions) {
    const label = session.label ?? session.id
    const duration = session.duration != null ? `${session.duration}ms` : 'ongoing'
    console.log(`${session.id.padEnd(40)}  ${duration.padEnd(10)}  ${label}`)
  }
})

program.command('plugins').description('Show plugin metadata for a session').option('--session-id <id>').action(async (opts) => {
  const session = await loadSession(opts)
  console.log(formatPlugins(session.meta))
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
  .option('--session-id <id>')
  .option('--filter <expr>', 'Boolean predicate per event (event), e.g. \'event.metadata.status >= 400\'')
  .option('--format <fmt>', 'Output format: text (default) or json')
  .option('--type <patterns>', 'Comma-separated event types. Supports prefix: "network.*"')
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
