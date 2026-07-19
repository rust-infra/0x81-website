import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

it('loads the shared design system from every mobile page', () => {
  const html = readFileSync('design/mobile/index.html', 'utf8')
  expect(html).toContain('../assets/tokens.css')
  expect(html).toContain('../assets/mobile.css')
})
