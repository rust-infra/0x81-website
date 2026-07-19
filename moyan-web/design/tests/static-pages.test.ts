import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const designPages = [
  'mobile/index.html',
  'mobile/decks.html',
  'mobile/stats.html',
  'mobile/settings.html',
  'web/index.html',
  'web/decks.html',
  'web/stats.html',
  'web/settings.html',
]

const executableDesignFiles = [
  ...designPages,
  'assets/mock-data.js',
  'assets/prototype.js',
]

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

it.each(['index', 'decks', 'stats', 'settings'])('has web %s page', (name) => {
  const html = readFileSync(`design/web/${name}.html`, 'utf8')
  expect(html).toContain('top-nav')
  expect(html).toContain('data-toast')
})

it.each(executableDesignFiles)('keeps %s isolated from production services, persistence, and file transfer', (file) => {
  const source = readFileSync(`design/${file}`, 'utf8')

  expect(source).not.toMatch(/fetch\s*\(|\/api\/|XMLHttpRequest|axios\b/i)
  expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/i)
  expect(source).not.toMatch(/FileReader|<input\b[^>]*\btype\s*=\s*["']?file\b/i)
  expect(source).not.toMatch(/\bdownload\s*=|URL\.createObjectURL|\b(?:upload|download)\s*\(/i)
})
