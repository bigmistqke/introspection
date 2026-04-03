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
import { fileURLToPath } from 'url'
import { listSkills, detectPlatform, getInstallRoot, installSkills } from './commands/skills.js'

const DEFAULT_OUT_DIR = resolve('.introspect')
const BUNDLED_SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url))
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

    // Validate explicit --platform
    if (opts.platform && opts.platform !== 'claude') {
      console.error(`Unknown platform: ${opts.platform}. Supported platforms: claude`)
      process.exit(1)
    }

    // Warn if --dir and --platform both given
    if (opts.dir && opts.platform) {
      process.stderr.write('Warning: --platform is ignored when --dir is specified.\n')
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

program.parseAsync()
