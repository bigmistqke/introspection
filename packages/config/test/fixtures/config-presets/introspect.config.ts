import type { IntrospectConfig } from '@introspection/types'

const config: IntrospectConfig = {
  plugins: {
    default: [{ name: 'fixture-default-plugin', install: async () => {} }],
    network: [{ name: 'fixture-network-plugin', install: async () => {} }],
  },
}
export default config
