import '../src/index.js'
import './widgets/event-timeline.js'
import './widgets/event-detail.js'
import { session } from './fake-session.js'
import type { IntrospectView } from '../src/index.js'

const view = document.querySelector<IntrospectView>('introspect-view')!
view.session = session
