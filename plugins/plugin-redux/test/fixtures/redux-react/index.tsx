import React from 'react'
import ReactDOM from 'react-dom/client'
import { createStore, compose, Reducer, Action } from 'redux'
import { Provider, useDispatch, useSelector } from 'react-redux'

interface State {
  count: number
  items: string[]
}

interface CountAction extends Action<string> {
  type: 'INCREMENT' | 'DECREMENT'
}

interface AddItemAction extends Action<string> {
  type: 'ADD_ITEM'
  payload: string
}

const initialState: State = { count: 0, items: [] }

const reducer: Reducer<State, CountAction | AddItemAction> = (state = initialState, action) => {
  switch (action.type) {
    case 'INCREMENT':
      return { ...state, count: state.count + 1 }
    case 'DECREMENT':
      return { ...state, count: state.count - 1 }
    case 'ADD_ITEM':
      return { ...state, items: [...state.items, action.payload] }
    default:
      return state
  }
}

const composeEnhancers =
  (typeof window !== 'undefined' && (window as any).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__) || compose
const store = createStore(reducer, composeEnhancers())

function Counter() {
  const dispatch = useDispatch()
  const count = useSelector((state: State) => state.count)
  const items = useSelector((state: State) => state.items)

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Redux + React Counter</h1>
      <p id="count">Count: {count}</p>
      <button id="increment" onClick={() => dispatch({ type: 'INCREMENT' })}>
        Increment
      </button>
      <button id="decrement" onClick={() => dispatch({ type: 'DECREMENT' })}>
        Decrement
      </button>
      <button id="add-item" onClick={() => dispatch({ type: 'ADD_ITEM', payload: `item-${Date.now()}` })}>
        Add Item
      </button>
      <p id="items">Items: {items.length}</p>
    </div>
  )
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(
  <Provider store={store}>
    <Counter />
  </Provider>
)
