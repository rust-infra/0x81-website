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

it('uses a softer dedicated radius for card surfaces', () => {
  const tokens = readFileSync('design/assets/tokens.css', 'utf8')
  const mobileCss = readFileSync('design/assets/mobile.css', 'utf8')
  const webCss = readFileSync('design/assets/web.css', 'utf8')

  expect(tokens).toContain('--card-radius:16px')
  expect(mobileCss).toContain('border-radius:var(--card-radius)')
  expect(webCss).toContain('border-radius:var(--card-radius)')
})

it.each(['index', 'decks', 'stats', 'settings'])('has mobile %s page', (name) => {
  const html = readFileSync(`design/mobile/${name}.html`, 'utf8')
  expect(html).toContain('data-toast')
  expect(html).toContain('bottom-nav')
})

it('gives the mobile home page a primary study card and secondary typing card', () => {
  const html = readFileSync('design/mobile/index.html', 'utf8')

  expect(html).toContain('每日必修')
  expect(html).toContain('打字训练')
  expect(html).toContain('data-open-modal="study"')
  expect(html).toContain('data-toast-action="打字训练将在下一版设计稿中展开"')
})

it.each(['index', 'decks', 'stats', 'settings'])('has web %s page', (name) => {
  const html = readFileSync(`design/web/${name}.html`, 'utf8')
  expect(html).toContain('top-nav')
  expect(html).toContain('data-toast')
})

it.each(designPages)('uses Decks copy in %s', (file) => {
  const html = readFileSync(`design/${file}`, 'utf8')

  expect(html).not.toContain('词库')
})

it.each(executableDesignFiles)('keeps %s isolated from production services, persistence, and file transfer', (file) => {
  const source = readFileSync(`design/${file}`, 'utf8')

  expect(source).not.toMatch(/fetch\s*\(|\/api\/|XMLHttpRequest|axios\b|sendBeacon\s*\(|new\s+WebSocket\b|new\s+EventSource\b|\$\.(?:ajax|get|post)\s*\(/i)
  expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/i)
  expect(source).not.toMatch(/FileReader|<input\b[^>]*\btype\s*=\s*["']?file\b|\.type\s*=\s*["']file["']/i)
  expect(source).not.toMatch(/\bdownload\s*=|\.download\s*=|URL\.createObjectURL|\b(?:upload|download)\s*\(/i)
})
