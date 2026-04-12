import { redux } from '@introspection/plugin-redux'
import { defaults } from '@introspection/plugin-defaults'

export default {
  plugins: [redux({ captureState: true }), ...defaults()],
}
