import { useState } from 'react'
import { createRoot } from 'react-dom/client'

function Counter() {
  const [count, setCount] = useState(0)
  return (
    <div>
      <p id="count">Count: {count}</p>
      <button id="increment" onClick={() => setCount(c => c + 1)}>increment</button>
    </div>
  )
}

function App() {
  return <Counter />
}

createRoot(document.getElementById('root')!).render(<App />)
