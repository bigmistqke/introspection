import 'solid-devtools'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'

function Counter() {
  const [count, setCount] = createSignal(0)
  return <button onClick={() => setCount(count() + 1)}>Count: {count()}</button>
}

render(() => <Counter />, document.getElementById('app')!)
