import 'solid-devtools'
import '@introspection/plugin-solid/setup'
import { render } from 'solid-js/web'
import App from './App.jsx'

render(() => <App />, document.getElementById('app')!)
