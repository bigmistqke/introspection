import { Routes, Route, Navigate } from 'react-router-dom'
import CheckoutPage from './pages/CheckoutPage.js'
import SuccessPage from './pages/SuccessPage.js'

export default function App() {
  return (
    <Routes>
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/success" element={<SuccessPage />} />
      <Route path="*" element={<Navigate to="/checkout" replace />} />
    </Routes>
  )
}
