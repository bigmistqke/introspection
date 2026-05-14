import type { TestInfo } from '@playwright/test'

/** Lowercase, collapse any non-alphanumeric run to a single dash, trim dashes. */
export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * The per-test session directory name: `<project>__<titlePath-slug>` with a
 * `-<retry>` suffix on retries. Project is encoded as a filename prefix, not a
 * structural directory level — `ls <run-dir>/` still groups by project, the
 * tree stays two-level.
 */
export function testIdFor(testInfo: TestInfo): string {
  const project = slugify(testInfo.project.name) || 'default'
  const slug = slugify(testInfo.titlePath.join(' '))
  const suffix = testInfo.retry > 0 ? `-${testInfo.retry}` : ''
  return `${project}__${slug}${suffix}`
}
