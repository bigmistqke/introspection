async function load() {
  const response = await fetch('/api/scores')
  const data = await response.json()
  const { scores = [] } = data
  const board = document.getElementById('board')!
  if (scores.length === 0) {
    board.innerHTML = '<p id="empty">No scores yet.</p>'
    return
  }
  board.innerHTML = scores
    .map((score: { name: string; points: number }) =>
      `<div class="score-entry"><span class="name">${score.name}</span><span class="points">${score.points}</span></div>`)
    .join('')
}

load()
