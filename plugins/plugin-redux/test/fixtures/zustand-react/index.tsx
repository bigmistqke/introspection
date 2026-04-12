import React from 'react'
import ReactDOM from 'react-dom/client'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface StoreState {
  count: number
  items: string[]
  increment: () => void
  decrement: () => void
  addItem: (item: string) => void
}

const useStore = create<StoreState>(
  devtools(
    (set) => ({
      count: 0,
      items: [],
      increment: () => set((state) => ({ count: state.count + 1 })),
      decrement: () => set((state) => ({ count: state.count - 1 })),
      addItem: (item: string) => set((state) => ({ items: [...state.items, item] })),
    }),
    { name: 'zustand-store' }
  )
)

function Counter() {
  const count = useStore((state) => state.count)
  const items = useStore((state) => state.items)
  const increment = useStore((state) => state.increment)
  const decrement = useStore((state) => state.decrement)
  const addItem = useStore((state) => state.addItem)

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Zustand + React Counter</h1>
      <p id="count">Count: {count}</p>
      <button id="increment" onClick={() => increment()}>
        Increment
      </button>
      <button id="decrement" onClick={() => decrement()}>
        Decrement
      </button>
      <button id="add-item" onClick={() => addItem(`item-${Date.now()}`)}>
        Add Item
      </button>
      <p id="items">Items: {items.length}</p>
    </div>
  )
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(<Counter />)
