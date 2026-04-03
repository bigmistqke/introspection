import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, access } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { listSkills, detectPlatform, getInstallRoot, installSkills } from '../../src/commands/skills.js'

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), 'introspect-skills-test-'))
}

async function makeSkill(dir: string, name: string, frontmatter: string, body = '# content') {
  const skillDir = join(dir, name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'skill.md'), `---\n${frontmatter}\n---\n\n${body}`)
}

describe('listSkills', () => {
  let tmp: string
  beforeEach(async () => { tmp = await makeTmpDir() })
  afterEach(async () => { await rm(tmp, { recursive: true }) })

  it('returns skills sorted by name', async () => {
    await makeSkill(tmp, 'introspect-setup', 'name: introspect-setup\ndescription: Setup skill')
    await makeSkill(tmp, 'introspect-debug', 'name: introspect-debug\ndescription: Debug skill')
    const skills = await listSkills(tmp)
    expect(skills).toEqual([
      { name: 'introspect-debug', description: 'Debug skill' },
      { name: 'introspect-setup', description: 'Setup skill' },
    ])
  })

  it('skips entries with missing frontmatter', async () => {
    await makeSkill(tmp, 'bad-skill', '', '')  // no frontmatter content
    await makeSkill(tmp, 'introspect-debug', 'name: introspect-debug\ndescription: Debug skill')
    const skills = await listSkills(tmp)
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('introspect-debug')
  })

  it('returns empty array for empty directory', async () => {
    const skills = await listSkills(tmp)
    expect(skills).toEqual([])
  })
})

describe('detectPlatform', () => {
  let tmp: string
  beforeEach(async () => { tmp = await makeTmpDir() })
  afterEach(async () => { await rm(tmp, { recursive: true }) })

  it('returns claude with detected: true when .claude/ directory exists', async () => {
    await mkdir(join(tmp, '.claude'))
    const result = await detectPlatform(tmp)
    expect(result).toEqual({ platform: 'claude', detected: true })
  })

  it('returns error when GEMINI.md exists but no .claude/', async () => {
    await writeFile(join(tmp, 'GEMINI.md'), '')
    const result = await detectPlatform(tmp)
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('Gemini')
  })

  it('returns error when both .claude/ and GEMINI.md exist', async () => {
    await mkdir(join(tmp, '.claude'))
    await writeFile(join(tmp, 'GEMINI.md'), '')
    const result = await detectPlatform(tmp)
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('Multiple')
  })

  it('returns claude with detected: false when neither found', async () => {
    const result = await detectPlatform(tmp)
    // neither → defaults to claude, detected: false signals caller to warn
    expect(result).toEqual({ platform: 'claude', detected: false })
  })
})

describe('getInstallRoot', () => {
  it('returns .claude/plugins relative to cwd for claude platform', () => {
    const root = getInstallRoot({ platform: 'claude', cwd: '/my/project' })
    expect(root).toBe('/my/project/.claude/plugins')
  })

  it('returns custom dir when --dir is provided', () => {
    const root = getInstallRoot({ platform: 'claude', cwd: '/my/project', dir: '/custom/path' })
    expect(root).toBe('/custom/path')
  })

  it('resolves relative --dir against cwd', () => {
    const root = getInstallRoot({ platform: 'claude', cwd: '/my/project', dir: 'custom/plugins' })
    expect(root).toBe('/my/project/custom/plugins')
  })
})

describe('installSkills', () => {
  let skillsDir: string
  let installRoot: string
  beforeEach(async () => {
    skillsDir = await makeTmpDir()
    installRoot = await makeTmpDir()
  })
  afterEach(async () => {
    await rm(skillsDir, { recursive: true })
    await rm(installRoot, { recursive: true })
  })

  it('installs all skills into installRoot/introspect-<name>/skill.md', async () => {
    await makeSkill(skillsDir, 'introspect-debug', 'name: introspect-debug\ndescription: Debug')
    await makeSkill(skillsDir, 'introspect-setup', 'name: introspect-setup\ndescription: Setup')

    const results = await installSkills(skillsDir, installRoot)

    expect(results).toHaveLength(2)
    for (const r of results) {
      await expect(access(r.path)).resolves.toBeUndefined()
    }
    expect(results.find(r => r.name === 'introspect-debug')?.path).toBe(
      join(installRoot, 'introspect-debug', 'skill.md')
    )
  })

  it('creates nested directories if they do not exist', async () => {
    const deepRoot = join(installRoot, 'a', 'b', 'c')
    await makeSkill(skillsDir, 'introspect-debug', 'name: introspect-debug\ndescription: Debug')
    await installSkills(skillsDir, deepRoot)
    await expect(access(join(deepRoot, 'introspect-debug', 'skill.md'))).resolves.toBeUndefined()
  })

  it('reports overwritten: true when file already exists', async () => {
    await makeSkill(skillsDir, 'introspect-debug', 'name: introspect-debug\ndescription: Debug')
    await installSkills(skillsDir, installRoot)
    const results = await installSkills(skillsDir, installRoot)
    expect(results[0].overwritten).toBe(true)
  })

  it('reports overwritten: false for new installs', async () => {
    await makeSkill(skillsDir, 'introspect-debug', 'name: introspect-debug\ndescription: Debug')
    const results = await installSkills(skillsDir, installRoot)
    expect(results[0].overwritten).toBe(false)
  })
})
