import { Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

createRoot(document.getElementById('root')!).render(
  <Suspense fallback={<p style={{ color: '#666' }}>Loading sessions...</p>}>
    <App />
  </Suspense>
)
