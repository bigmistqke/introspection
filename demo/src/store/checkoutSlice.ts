import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

interface CheckoutState {
  validationErrors: string[] | null
}

const initialState: CheckoutState = { validationErrors: null }

export const checkoutSlice = createSlice({
  name: 'checkout',
  initialState,
  reducers: {
    setValidationErrors(state, action: PayloadAction<string[]>) {
      state.validationErrors = action.payload
    },
    clearValidationErrors(state) {
      state.validationErrors = null
    },
  },
})

export const { setValidationErrors, clearValidationErrors } = checkoutSlice.actions
export default checkoutSlice.reducer
