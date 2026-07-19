import { describe, expect, it } from 'vitest'
import { trendBars } from '../assets/prototype.js'

describe('prototype helpers', () => {
  it('maps trend values to nonzero percentage heights', () => {
    expect(trendBars([0, 10, 20])).toEqual([10, 50, 100])
  })
})
