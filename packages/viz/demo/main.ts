import '../src/index.js'
import './widgets/event-timeline.js'
import './widgets/event-detail.js'
import { adapter } from './fake-session.js'
import { createSessionReader } from '@introspection/read'
import type { IntrospectSession } from '../src/index.js'

const element = document.querySelector<IntrospectSession>('introspect-session')!
createSessionReader(adapter, 'demo-session').then(session => {
  element.session = session
})
