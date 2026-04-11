import '@introspection/viz'
import './widgets/event-graph.js'
import { adapter } from './fake-data.js'
import { createSessionReader } from '@introspection/read'
import type { IntrospectSession } from '@introspection/viz'

const element = document.querySelector<IntrospectSession>('introspect-session')!
createSessionReader(adapter, 'graph-session').then(session => {
  element.session = session
})
