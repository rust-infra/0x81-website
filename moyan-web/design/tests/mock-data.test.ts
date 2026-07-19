import { describe, expect, it } from 'vitest'
import { DECKS, LEARNING, filterDecks, sortDecks } from '../assets/mock-data.js'

describe('mock data', () => {
  it('exposes the approved daily learning state', () => {
    expect(LEARNING.due).toBe(24)
    expect(LEARNING.mastered).toBe(642)
    expect(LEARNING.accuracy).toBe(92)
  })

  it('filters and sorts decks deterministically', () => {
    expect(filterDecks('computer', 'all').map(deck => deck.id)).toEqual(['computer'])
    expect(filterDecks('', 'due')).toHaveLength(2)
    expect(sortDecks(DECKS, 'progress')[0].id).toBe('travel')
  })
})
