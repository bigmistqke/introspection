import React from 'react'
import ReactDOM from 'react-dom/client'
import { proxy, useSnapshot } from 'valtio'
import { devtools } from 'valtio/utils'

const state = proxy({
  count: 0,
  items: [],
})

devtools(state, { name: 'valtio-store' })

function Counter() {
  const snap = useSnapshot(state as any)

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Valtio + React Counter</h1>
      <p id="count">Count: {snap.count}</p>
      <button id="increment" onClick={() => { (state as any).count++ }}>
        Increment
      </button>
      <button id="decrement" onClick={() => { (state as any).count-- }}>
        Decrement
      </button>
      <button id="add-item" onClick={() => { (state as any).items.push(`item-${Date.now()}`) }}>
        Add Item
      </button>
      <p id="items">Items: {snap.items.length}</p>
    </div>
  )
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(<Counter />)
