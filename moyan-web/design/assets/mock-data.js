export const LEARNING = Object.freeze({
  user: '若谷', due: 24, minutes: 12, streak: 18, longestStreak: 32,
  mastered: 642, total: 944, accuracy: 92, todayReviews: 48,
})

export const DECKS = Object.freeze([
  { id: 'computer', name: '计算机英语', words: 286, due: 18, progress: 68, accuracy: 92, type: 'built-in' },
  { id: 'cet4', name: '大学英语四级', words: 350, due: 6, progress: 42, accuracy: 88, type: 'built-in' },
  { id: 'design', name: '产品设计术语', words: 128, due: 0, progress: 76, accuracy: 95, type: 'custom' },
  { id: 'thirty-day', name: '30 天高频词汇', words: 180, due: 0, progress: 31, accuracy: 90, type: 'plan' },
  { id: 'travel', name: '旅行英语', words: 86, due: 0, progress: 84, accuracy: 96, type: 'custom' },
])

export const TREND_RANGES = Object.freeze({
  7: [28, 36, 49, 31, 58, 62, 22],
  30: [52, 67, 44, 78, 61, 83, 72, 56, 91, 65],
  90: [35, 48, 59, 52, 68, 74, 81, 66, 88, 76, 93, 84],
})

export const THEMES = Object.freeze([
  { id: 'xuanzhi', label: '宣纸白', paper: '#f6f2e9' },
  { id: 'shenyemo', label: '深夜墨', paper: '#222321' },
  { id: 'zhuqing', label: '竹青', paper: '#e4ece5' },
  { id: 'zhusha', label: '朱砂', paper: '#f4e5df' },
])

export const filterDecks = (query, filter) => DECKS.filter((deck) =>
  (deck.name.toLowerCase().includes(query.trim().toLowerCase()) ||
    deck.id.toLowerCase().includes(query.trim().toLowerCase())) &&
  (filter === 'all' || (filter === 'due' && deck.due > 0) || deck.type === filter),
)

export const sortDecks = (decks, mode) => [...decks].sort((a, b) =>
  mode === 'progress' ? b.progress - a.progress : mode === 'due' ? b.due - a.due : 0,
)
