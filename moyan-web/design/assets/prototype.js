import { filterDecks, sortDecks, TREND_RANGES } from './mock-data.js'

export const trendBars = (values) => {
  const maximum = Math.max(...values, 1)
  return values.map((value) => Math.max(10, Math.round((value / maximum) * 100)))
}

export const showToast = (root, message) => {
  const toast = root.querySelector('[data-toast]')
  toast.textContent = message
  toast.hidden = false
  clearTimeout(toast.timeoutId)
  toast.timeoutId = setTimeout(() => { toast.hidden = true }, 1600)
}

export const renderDecks = (root, decks = filterDecks('', 'all')) => {
  const container = root.querySelector('[data-decks]')
  if (!container) return

  container.innerHTML = sortDecks(decks, 'name').map((deck) => `
    <article data-deck="${deck.id}">
      <h3>${deck.name}</h3>
      <p>${deck.words} words &middot; ${deck.due} due</p>
    </article>
  `).join('')
}

export const renderTrend = (root, range) => {
  const container = root.querySelector('[data-trend]')
  if (!container) return

  container.innerHTML = trendBars(TREND_RANGES[range] || []).map((height) =>
    `<i style="height: ${height}%"></i>`,
  ).join('')
}

export const bindPrototype = (root = document) => {
  root.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
    root.querySelectorAll('[data-tab], [data-pane]').forEach((node) => node.classList.remove('is-active'))
    button.classList.add('is-active')
    root.querySelector(`[data-pane="${button.dataset.tab}"]`).classList.add('is-active')
  }))
}
