import { configureStore } from '@reduxjs/toolkit'
import { BrowserAgent } from '@introspection/browser'
import { createReduxPlugin } from '@introspection/plugin-redux'
import checkoutReducer from './checkoutSlice.js'

export const store = configureStore({
  reducer: { checkout: checkoutReducer },
})

// Connect to the introspection server when running inside a Playwright session.
// attach() in @introspection/playwright injects these globals via page.addInitScript().
const w = window as Window & { __INTROSPECT_SESSION_ID__?: string; __INTROSPECT_WS_URL__?: string }
if (w.__INTROSPECT_SESSION_ID__) {
  const agent = BrowserAgent.connect(
    w.__INTROSPECT_WS_URL__ ?? 'ws://localhost:5173/__introspection',
    w.__INTROSPECT_SESSION_ID__,
  )
  agent.use(createReduxPlugin(store))
}

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
