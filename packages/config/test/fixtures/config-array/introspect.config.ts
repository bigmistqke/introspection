import type { IntrospectConfig } from '@introspection/types'

const config: IntrospectConfig = {
  plugins: [{ name: 'fixture-array-plugin', install: async () => {} }],
}
export default config
