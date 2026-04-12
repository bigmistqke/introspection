async function apiPost(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.ok) {
    return { data: await response.json(), status: response.status }
  }
  return { data: undefined, status: response.status }
}

function handlePaymentResponse(response: { data: { errors?: Array<{ message: string }> }; status: number }) {
  const errors = response.data.errors
  const el = document.querySelector('[data-testid=card-error]') as HTMLElement
  el.textContent = errors!.map(error => error.message).join(', ')
  el.style.display = 'block'
}

document.getElementById('payment-form')!.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault()
  const card = (submitEvent.target as HTMLFormElement).querySelector<HTMLInputElement>('[name=card]')!.value
  apiPost('/api/payment/validate', { card })
    .then(handlePaymentResponse)
    .catch(() => {})
})
