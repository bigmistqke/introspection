import { defineConfig } from '@playwright/test'
import { withIntrospect } from '@introspection/playwright'

export default withIntrospect(
  defineConfig({
    testDir: '.',
    testMatch: 'sample.spec.ts',
    use: { headless: true },
  }),
  { plugins: [] },
)
