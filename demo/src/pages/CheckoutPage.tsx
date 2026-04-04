import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { api } from '../api/client.js'
import { setValidationErrors, clearValidationErrors } from '../store/checkoutSlice.js'
import type { RootState } from '../store/index.js'

export default function CheckoutPage() {
  const [card, setCard] = useState('')
  const dispatch = useDispatch()
  const errors = useSelector((s: RootState) => s.checkout.validationErrors)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    dispatch(clearValidationErrors())
    const response = await api.post<{ errors: Array<{ field: string; message: string }> }>(
      '/api/payment/validate',
      { card },
    )
    dispatch(setValidationErrors(response.data!.errors.map(err => err.message)))
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Checkout</h1>
      <label>
        Card number
        <input name="card" value={card} onChange={e => setCard(e.target.value)} />
      </label>
      {errors && (
        <ul data-testid="card-error">
          {errors.map((msg, i) => <li key={i}>{msg}</li>)}
        </ul>
      )}
      <button type="submit">Pay now</button>
    </form>
  )
}
