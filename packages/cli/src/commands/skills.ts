import { readdir, readFile, mkdir, writeFile, access } from 'fs/promises'
import { join, resolve, isAbsolute } from 'path'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SkillMeta {
  name: string
  description: string
}

export interface InstallResult {
  name: string
  path: string
  overwritten: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return null
  const result: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':')
    if (key && rest.length) result[key.trim()] = rest.join(':').trim()
  }
  return result
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true } catch { return false }
}

// ─── Exported logic ───────────────────────────────────────────────────────────

export async function listSkills(skillsDir: string): Promise<SkillMeta[]> {
  let dirents: import('fs').Dirent[]
  try {
    dirents = await readdir(skillsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const skills: SkillMeta[] = []
  for (const entry of dirents.filter(d => d.isDirectory()).map(d => d.name).sort()) {
    const skillFile = join(skillsDir, entry, 'skill.md')
    let content: string
    try { content = await readFile(skillFile, 'utf8') } catch { continue }
    const fm = parseFrontmatter(content)
    if (!fm?.name || !fm?.description) {
      process.stderr.write(`Warning: could not parse skill at ${skillFile}, skipping.\n`)
      continue
    }
    skills.push({ name: fm.name, description: fm.description })
  }
  return skills
}

export async function detectPlatform(
  cwd: string
): Promise<{ platform: 'claude'; detected: boolean } | { error: string }> {
  const hasClaude = await exists(join(cwd, '.claude'))
  const hasGemini = await exists(join(cwd, 'GEMINI.md'))

  if (hasClaude && hasGemini) {
    return { error: 'Multiple platforms detected. Use --platform claude to specify one. (Gemini support is not yet implemented.)' }
  }
  if (hasGemini) {
    return { error: 'Gemini platform detected but not yet implemented. Use --platform claude.' }
  }
  return { platform: 'claude', detected: hasClaude }
}

export function getInstallRoot(opts: { platform: 'claude'; cwd: string; dir?: string }): string {
  if (opts.dir) {
    return isAbsolute(opts.dir) ? opts.dir : resolve(opts.cwd, opts.dir)
  }
  return join(opts.cwd, '.claude', 'plugins')
}

export async function installSkills(skillsDir: string, installRoot: string): Promise<InstallResult[]> {
  let dirents: import('fs').Dirent[]
  try {
    dirents = await readdir(skillsDir, { withFileTypes: true })
  } catch {
    throw new Error(`Could not find bundled skills directory. Try reinstalling the introspect package.`)
  }

  const results: InstallResult[] = []
  for (const entry of dirents.filter(d => d.isDirectory()).map(d => d.name).sort()) {
    const srcFile = join(skillsDir, entry, 'skill.md')
    let content: string
    try { content = await readFile(srcFile, 'utf8') } catch { continue }

    const destDir = join(installRoot, entry)
    const destFile = join(destDir, 'skill.md')
    const overwritten = await exists(destFile)

    await mkdir(destDir, { recursive: true })
    await writeFile(destFile, content, 'utf8')

    results.push({ name: entry, path: destFile, overwritten })
  }
  return results
}
