import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

it('loads the shared design system from every mobile page', () => {
  const html = readFileSync('design/mobile/index.html', 'utf8')
  expect(html).toContain('../assets/tokens.css')
  expect(html).toContain('../assets/mobile.css')
})

it('provides shared modal and toast surfaces', () => {
  const css = readFileSync('design/assets/tokens.css', 'utf8')
  expect(css).toContain('.modal {')
  expect(css).toContain('.toast {')
  expect(css).toContain('border-radius:var(--radius)')
})

it.each(['index', 'decks', 'stats', 'settings'])('has mobile %s page', (name) => {
  const html = readFileSync(`design/mobile/${name}.html`, 'utf8')
  expect(html).toContain('data-toast')
  expect(html).toContain('bottom-nav')
})
