# Moyan UI Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build eight interactive static HTML design references for Moyan's Home, Decks, Stats, and Settings routes across independent Mobile and Web/PWA shells.

**Architecture:** Place self-contained static references in `moyan-web/design/`. Shared ES modules provide deterministic mock learning data and route-local prototype behavior; shared tokens and platform CSS provide the Modern Study system. Each HTML page imports shared assets and only supplies semantic page markup and page-specific data attributes.

**Tech Stack:** Static HTML5, CSS custom properties, vanilla ES modules, Vitest 4, Vite 7.

## Global Constraints

- Create references only under `moyan-web/design/`; do not modify `moyan-web/src/` or production routes.
- Deliver eight standalone pages: four Mobile pages and four Web pages.
- Use mock data only. Do not make API calls, persist data, read files, upload files, trigger downloads, or invoke production services.
- Mobile reference viewport is `390 x 844`; Web/PWA reference viewport is `1440 x 900`.
- Use the Modern Study palette: warm paper, dark ink, restrained cinnabar primary action, and low-radius functional surfaces.
- Keep platform navigation independent: Mobile bottom navigation; Web top navigation.
- Exercise all interactive controls with visible local state or toast feedback.

---

## File Map

| Path | Responsibility |
| --- | --- |
| `moyan-web/design/assets/mock-data.js` | Frozen mock decks, learning metrics, time ranges, themes, and helper selectors. |
| `moyan-web/design/assets/prototype.js` | DOM-only navigation, toast, modal, filtering, sorting, range-chart, tabs, and theme behavior. |
| `moyan-web/design/assets/tokens.css` | Modern Study color, type, spacing, radius, and shared component variables. |
| `moyan-web/design/assets/mobile.css` | Mobile shell, bottom navigation, one-column content, and mobile-specific controls. |
| `moyan-web/design/assets/web.css` | Web top navigation, constrained content, grids, and modal layout. |
| `moyan-web/design/mobile/*.html` | Four 390px Mobile reference pages. |
| `moyan-web/design/web/*.html` | Four 1440px Web/PWA reference pages. |
| `moyan-web/design/tests/*.test.ts` | Unit and static-reference smoke tests. |

### Task 1: Establish Mock Data and Unit Tests

**Files:**
- Create: `moyan-web/design/assets/mock-data.js`
- Create: `moyan-web/design/tests/mock-data.test.ts`

**Interfaces:**
- Produces: `DECKS`, `LEARNING`, `TREND_RANGES`, `THEMES`, `filterDecks(query, filter)`, and `sortDecks(decks, mode)`.
- Consumes: no application code or network state.

- [ ] **Step 1: Write failing mock-data tests**

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd moyan-web && npx vitest run design/tests/mock-data.test.ts`

Expected: FAIL because `assets/mock-data.js` does not exist.

- [ ] **Step 3: Implement the deterministic data module**

```js
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
  deck.name.toLowerCase().includes(query.trim().toLowerCase()) &&
  (filter === 'all' || (filter === 'due' && deck.due > 0) || deck.type === filter),
)

export const sortDecks = (decks, mode) => [...decks].sort((a, b) =>
  mode === 'progress' ? b.progress - a.progress : mode === 'due' ? b.due - a.due : 0,
)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd moyan-web && npx vitest run design/tests/mock-data.test.ts`

Expected: PASS with two tests.

- [ ] **Step 5: Commit**

```bash
git add moyan-web/design/assets/mock-data.js moyan-web/design/tests/mock-data.test.ts
git commit -m "feat: add moyan design mock data"
```

### Task 2: Build the Shared Prototype Runtime

**Files:**
- Create: `moyan-web/design/assets/prototype.js`
- Create: `moyan-web/design/tests/prototype.test.ts`

**Interfaces:**
- Consumes: `filterDecks`, `sortDecks`, and `TREND_RANGES` from `mock-data.js`.
- Produces: `showToast(root, message)`, `renderDecks(root, decks)`, `renderTrend(root, range)`, and `bindPrototype(root)`.

- [ ] **Step 1: Write failing runtime tests**

```ts
import { describe, expect, it } from 'vitest'
import { trendBars } from '../assets/prototype.js'

describe('prototype helpers', () => {
  it('maps trend values to nonzero percentage heights', () => {
    expect(trendBars([0, 10, 20])).toEqual([10, 50, 100])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd moyan-web && npx vitest run design/tests/prototype.test.ts`

Expected: FAIL because `assets/prototype.js` does not exist.

- [ ] **Step 3: Implement the small DOM runtime**

```js
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

export const bindPrototype = (root = document) => {
  root.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
    root.querySelectorAll('[data-tab], [data-pane]').forEach((node) => node.classList.remove('is-active'))
    button.classList.add('is-active')
    root.querySelector(`[data-pane="${button.dataset.tab}"]`).classList.add('is-active')
  }))
}
```

- [ ] **Step 4: Run the runtime tests**

Run: `cd moyan-web && npx vitest run design/tests/prototype.test.ts`

Expected: PASS with one test.

- [ ] **Step 5: Commit**

```bash
git add moyan-web/design/assets/prototype.js moyan-web/design/tests/prototype.test.ts
git commit -m "feat: add moyan design prototype runtime"
```

### Task 3: Create Shared Tokens and Platform Shell Styles

**Files:**
- Create: `moyan-web/design/assets/tokens.css`
- Create: `moyan-web/design/assets/mobile.css`
- Create: `moyan-web/design/assets/web.css`
- Create: `moyan-web/design/tests/static-pages.test.ts`

**Interfaces:**
- Consumes: semantic classes and `data-*` hooks declared in the eight HTML pages.
- Produces: `.mobile-shell`, `.web-shell`, `.bottom-nav`, `.top-nav`, `.modal`, `.toast`, and Modern Study variables.

- [ ] **Step 1: Write the failing static-reference test**

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

it('loads the shared design system from every mobile page', () => {
  const html = readFileSync('design/mobile/index.html', 'utf8')
  expect(html).toContain('../assets/tokens.css')
  expect(html).toContain('../assets/mobile.css')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd moyan-web && npx vitest run design/tests/static-pages.test.ts`

Expected: FAIL because the first HTML page is not yet present.

- [ ] **Step 3: Create token and shell CSS**

```css
:root { --paper:#f6f2e9; --surface:#fff; --ink:#282723; --muted:#81786d; --accent:#9e4540; --border:#ded7ca; --radius:6px; }
body { margin:0; background:var(--paper); color:var(--ink); font-family:Inter,system-ui,sans-serif; }
.display { font-family:'Noto Serif SC',Georgia,serif; }
.toast[hidden] { display:none; }
```

```css
.mobile-shell { min-height:100dvh; max-width:390px; margin:auto; padding:26px 18px 96px; box-sizing:border-box; }
.bottom-nav { position:fixed; inset:auto 16px 17px; height:60px; border-radius:999px; }
```

```css
.web-shell { max-width:1120px; margin:auto; padding:36px 40px 56px; }
.top-nav { height:68px; display:flex; align-items:center; gap:28px; }
```

- [ ] **Step 4: Run the static test after adding `mobile/index.html` in Task 4**

Run: `cd moyan-web && npx vitest run design/tests/static-pages.test.ts`

Expected: PASS once the first page links the assets.

- [ ] **Step 5: Commit**

```bash
git add moyan-web/design/assets moyan-web/design/tests/static-pages.test.ts
git commit -m "feat: add moyan design system shells"
```

### Task 4: Implement the Four Mobile Reference Pages

**Files:**
- Create: `moyan-web/design/mobile/index.html`
- Create: `moyan-web/design/mobile/decks.html`
- Create: `moyan-web/design/mobile/stats.html`
- Create: `moyan-web/design/mobile/settings.html`

**Interfaces:**
- Consumes: all shared assets from Tasks 1-3.
- Produces: standalone Mobile references with a 390px bottom-navigation shell.

- [ ] **Step 1: Write failing page-link assertions**

```ts
it.each(['index', 'decks', 'stats', 'settings'])('has mobile %s page', (name) => {
  const html = readFileSync(`design/mobile/${name}.html`, 'utf8')
  expect(html).toContain('data-toast')
  expect(html).toContain('bottom-nav')
})
```

- [ ] **Step 2: Run the assertions to verify they fail**

Run: `cd moyan-web && npx vitest run design/tests/static-pages.test.ts`

Expected: FAIL because the four page files do not exist.

- [ ] **Step 3: Implement mobile Home and Decks**

Use `LEARNING` and `DECKS` to render the approved daily hero and searchable deck list. Include a `[data-modal="study"]` training preview, inline deck details, and a `[data-modal="add-deck"]` sheet with blank, Anki, and CSV choices. Each action calls `showToast` rather than interacting with files or services.

- [ ] **Step 4: Implement mobile Stats and Settings**

Render 18-day streak, four metrics, a 7/30/90 range control, trend bars, and mastery quality. Build General, Voice, and Theme settings panes; language, switches, and themes update local visual state only. Include explicit no-results, no-due, and no-data markup hidden by default.

- [ ] **Step 5: Run static tests and inspect the four pages**

Run: `cd moyan-web && npx vitest run design/tests/static-pages.test.ts`

Expected: PASS. Open each page at `390 x 844`; expected active bottom navigation, readable content, and reachable primary interactions.

- [ ] **Step 6: Commit**

```bash
git add moyan-web/design/mobile moyan-web/design/tests/static-pages.test.ts
git commit -m "feat: add moyan mobile design references"
```

### Task 5: Implement the Four Web/PWA Reference Pages

**Files:**
- Create: `moyan-web/design/web/index.html`
- Create: `moyan-web/design/web/decks.html`
- Create: `moyan-web/design/web/stats.html`
- Create: `moyan-web/design/web/settings.html`

**Interfaces:**
- Consumes: all shared assets from Tasks 1-3.
- Produces: standalone Web references with a 1120px top-navigation shell.

- [ ] **Step 1: Add failing Web page assertions**

```ts
it.each(['index', 'decks', 'stats', 'settings'])('has web %s page', (name) => {
  const html = readFileSync(`design/web/${name}.html`, 'utf8')
  expect(html).toContain('top-nav')
  expect(html).toContain('data-toast')
})
```

- [ ] **Step 2: Run the assertions to verify they fail**

Run: `cd moyan-web && npx vitest run design/tests/static-pages.test.ts`

Expected: FAIL because the Web page files do not exist.

- [ ] **Step 3: Implement Web Home and Decks**

Home uses the approved top navigation, two-column daily task layout, word of day, progress, and seven-day activity. Decks provides search, All/Due/Custom filters, sorting, a three-column deck grid, detail modal, and import/create modal.

- [ ] **Step 4: Implement Web Stats and Settings**

Stats combines range-controlled trend bars, streak, metric cards, mastery ring, and 18-week heatmap. Settings uses tabbed General, Voice, and Theme panes with a right-side preview.

- [ ] **Step 5: Run static tests and inspect the four pages**

Run: `cd moyan-web && npx vitest run design/tests/static-pages.test.ts`

Expected: PASS. Open each page at `1440 x 900`; expected readable top navigation, constrained content, working modal/tab/filter state, and no horizontal clipping.

- [ ] **Step 6: Commit**

```bash
git add moyan-web/design/web moyan-web/design/tests/static-pages.test.ts
git commit -m "feat: add moyan web design references"
```

### Task 6: Verify Interactions and Static Boundaries

**Files:**
- Modify: `moyan-web/design/tests/static-pages.test.ts`
- Modify: `moyan-web/design/README.md`

**Interfaces:**
- Consumes: all eight pages and shared assets.
- Produces: a documented verification workflow and automated guards against production coupling.

- [ ] **Step 1: Add failing static-boundary tests**

```ts
it('does not couple design references to production APIs', () => {
  const files = ['mobile/index.html', 'mobile/decks.html', 'web/index.html', 'web/decks.html']
  for (const file of files) {
    const html = readFileSync(`design/${file}`, 'utf8')
    expect(html).not.toMatch(/fetch\(|\/api\/|localStorage|input type="file"/)
  }
})
```

- [ ] **Step 2: Run the test to verify the current pages satisfy the boundary**

Run: `cd moyan-web && npx vitest run design/tests/static-pages.test.ts`

Expected: PASS after implementation because every action is local prototype state only.

- [ ] **Step 3: Document local preview and manual checks**

Create `moyan-web/design/README.md` with:

```markdown
1. Run `npm run dev` in `moyan-web`.
2. Open a design HTML file through the Vite static server.
3. Verify Mobile pages at 390 x 844 and Web pages at 1440 x 900.
4. Check navigation, modals, tabs, search, filters, sort, theme selection, no-results, no-due, and no-data states.
```

- [ ] **Step 4: Run the complete verification suite**

Run: `cd moyan-web && npm test && npm run check && npm run build`

Expected: all commands exit 0; Vite build continues to build the production app unchanged.

- [ ] **Step 5: Commit**

```bash
git add moyan-web/design
git commit -m "test: verify moyan design references"
```

## Plan Self-Review

- Spec coverage: Tasks 1-3 establish the shared assets; Tasks 4-5 cover all eight approved route/platform references; Task 6 covers mock-data boundaries, empty/error states, viewports, and build verification.
- Completeness scan: every task names exact files, commands, interfaces, and verification criteria.
- Interface consistency: mock-data exports are consumed by the prototype runtime and HTML pages; shared CSS is linked by every page; static tests use the same `design/` paths as the implementation tasks.
