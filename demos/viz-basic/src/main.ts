import '@introspection/viz'
import './widgets/event-timeline.js'
import './widgets/event-detail.js'
import { adapter } from './fake-data.js'
import { createSessionReader } from '@introspection/read'
import type { IntrospectSession } from '@introspection/viz'

const element = document.querySelector<IntrospectSession>('introspect-session')!
createSessionReader(adapter, 'demo-session').then(session => {
  element.session = session
})
