import '../src/index.js'
import './widgets/event-timeline.js'
import './widgets/event-detail.js'
import { session } from './fake-session.js'
import type { IntrospectSession } from '../src/index.js'

const element = document.querySelector<IntrospectSession>('introspect-session')!
element.session = session
