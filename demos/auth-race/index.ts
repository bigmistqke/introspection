let token: string | null = null

function loadProfile() {
  fetch('/api/profile', {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
    .then(r => r.json())
    .then((data: { error?: string; name?: string; role?: string }) => {
      if (data.error) {
        const errorEl = document.getElementById('error')!
        errorEl.textContent = data.error
        ;(errorEl as HTMLElement).style.display = 'block'
        return
      }
      document.getElementById('profile-name')!.textContent = data.name ?? ''
      document.getElementById('profile-role')!.textContent = data.role ?? ''
      ;(document.getElementById('profile') as HTMLElement).style.display = 'block'
    })
}

fetch('/api/auth')
  .then(r => r.json())
  .then((data: { token: string }) => { token = data.token })

loadProfile()
