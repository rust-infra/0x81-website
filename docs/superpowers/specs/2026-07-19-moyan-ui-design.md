# Moyan UI Design

## Purpose

Create interactive HTML design references for the existing Moyan routes. The references are for future UI work and do not replace or modify the React application.

## Scope

The design covers `/`, `/decks`, `/stats`, and `/settings` in two independent platform variants:

- Mobile App/PWA: designed at 390 x 844 with a bottom navigation bar.
- Web/PWA: designed at 1440 x 900 with a top navigation bar and a centered content area.

The deliverable is eight standalone HTML pages under `moyan-web/design/`, supported by shared static assets. Mobile and Web are intentionally separate documents rather than two responsive previews in one page. The design system, data, and interaction semantics remain shared so that iOS, Android, and a future desktop client can reuse the same page content with a platform-specific shell.

## File Structure

```text
moyan-web/design/
├── mobile/
│   ├── index.html
│   ├── decks.html
│   ├── stats.html
│   └── settings.html
├── web/
│   ├── index.html
│   ├── decks.html
│   ├── stats.html
│   └── settings.html
└── assets/
    ├── tokens.css
    ├── mobile.css
    ├── web.css
    ├── mock-data.js
    └── prototype.js
```

Each page includes the shared assets with relative paths. Navigation links resolve to the corresponding design page of the same platform.

## Visual Direction

The selected direction is **Modern Study**:

- Warm paper background, dark ink text, and restrained cinnabar red for priority actions.
- Chinese serif display text for page titles and learning words; a compact sans-serif for controls, data, and supporting text.
- Low-radius functional panels, thin warm-gray dividers, and generous whitespace.
- No decorative word carousel or oversized ink animation. Meaningful learning state takes visual priority.

Shared CSS variables define paper, surface, ink, muted ink, cinnabar accent, green success state, borders, type scale, spacing, and 4-8px control radii.

## Platform Shells

Mobile pages use a fixed rounded bottom navigation with Today, Decks, Stats, and Settings. Each page is a single vertical flow with page padding that preserves access to the navigation.

Web pages use a top navigation with the Moyan brand, the four routes, and the current user avatar. Content is constrained to approximately 1120px. The home and statistics pages use wide-screen comparison layouts; the decks page uses a scannable grid; settings uses a split content and preview layout.

## Page Designs

### Home

Home makes the daily learning task the only primary action.

- Show greeting, date, 18-day streak, 24 due words, 12-minute estimate, and the active deck in the hero.
- Primary action opens a training-preview modal for `concurrency`; entering training changes the hero into an in-progress state.
- Show mastery count, overall progress, and accuracy as compact secondary metrics.
- Provide secondary entries for typing training and the current deck. Selecting either expands a short task summary.
- Web adds a secondary rail with word of the day, total mastery progress, and a seven-day activity view.

### Decks

Decks supports finding, comparing, and starting work from vocabulary collections.

- Show eight decks, 944 total words, and 24 due words.
- Support text search plus All, Due, and Custom filters; Web also supports sort choices.
- Use realistic decks: Computer English, CET-4, Product Design Terms, 30-Day High-Frequency Vocabulary, and Travel English.
- Each deck exposes word count, source/type, progress, due count, recent activity, and a review or browse action.
- Mobile expands an inline deck detail. Web opens a focused detail modal.
- New and import actions open a choice sheet/modal for blank deck, Anki `.apkg`, and CSV. They show prototype feedback only and do not upload files.

### Stats

Stats consolidates progress into useful, comparable learning signals.

- A streak module shows 18 days, a 32-day record, and recent daily activity.
- Four metrics show 642 mastered words, 92% review accuracy, 48 reviews today, and 24 due words.
- A 7/30/90-day range control redraws the review-trend bars with matching totals.
- Mastery quality displays a 92% ring and counts for mastered, learning, and not-started words.
- Web additionally includes an 18-week activity heatmap.

### Settings

Settings groups preferences without mixing them with navigation.

- Tabs: General, Voice, and Theme.
- General provides language selection, account/sync status, export, backup, restore, and a destructive clear-data entry.
- Voice provides a voice selector and toggles for automatic word playback and example playback.
- Theme provides Xuan Paper, Dark Ink, Bamboo Green, and Cinnabar choices; the selected theme updates the preview state.
- Destructive and external-data actions show a prototype acknowledgement; implementation must use confirmation before destructive work.

## Prototype Interaction Boundary

The design references implement core prototype interactions with mock data:

- Route navigation feedback.
- Buttons, tabs, filters, search, sorting, collapsible details, and switches.
- Training preview and deck creation/import modals or sheets.
- Theme selection and visual preview.
- Toast feedback for actions that would normally call a service.

They do not make API requests, persist data, trigger downloads, read local files, or perform actual import/export/synchronization.

## Empty and Error States

- Deck search/filter shows a no-results state when no deck matches.
- The implementation includes a no-due-words state for the Home hero and a no-data state for Stats charts.
- Import, sync, export, restore, and clear-data controls remain simulated; their implementation-facing copy makes the required next state clear.
- Destructive operations require a second confirmation in a production implementation.

## Verification

- Open all eight HTML files and verify their shared assets resolve.
- Test mobile pages at 390 x 844 and Web pages at 1440 x 900.
- Exercise every stated interaction and ensure it produces a visible state or feedback message.
- Verify active navigation and tab styling, no clipped text, no page overflow, and the bottom navigation remains reachable on Mobile.
- Verify the static pages make no network requests except browser font loading, if retained.
