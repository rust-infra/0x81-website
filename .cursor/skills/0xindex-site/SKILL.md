---
name: 0xindex-site
description: >-
  Develop and maintain the ai.0x81 product index site in 0xindex/. Covers
  bilingual i18n (en.json/zh.json), products.ts catalog, Astro components,
  and design constraints. Use when editing 0xindex, adding products, updating
  hero copy, i18n strings, ProductMatrixIDE, or the 0x81.uk main site.
---

# 0xindex Site Development

## Project context

- **App:** `0xindex/` — Astro 5 static site for `0x81.uk`
- **Brand:** `ai.0x81` — product center, matrix-first
- **Routes:** `/` (English), `/zh` (Chinese). English-first copy drives tone.
- **Runtime:** port `4320`, served via `server.ts` + Docker
- **Design spec:** `docs/superpowers/specs/2026-07-14-0xindex-main-site-design.md`

## Architecture

```
src/pages/index.astro      → imports en.json, lang="en"
src/pages/zh/index.astro   → imports zh.json, lang="zh"
src/data/products.ts       → catalog (id, status, stack, url?, codeLines)
src/i18n/{en,zh}.json      → all user-facing strings
src/components/            → Nav, Hero, ProductMatrixIDE, Footer
```

Pages pass `t` (translations) and `products` to components. Components must not hardcode copy — use `t.*` keys.

## Adding or editing a product

Update **three places** in lockstep:

1. **`src/data/products.ts`** — add entry with `id`, `status` (`live` | `soon`), `stack`, `fileName`, optional `url`, `codeLines`
2. **`src/i18n/en.json`** — add `products.<id>.blurb`
3. **`src/i18n/zh.json`** — mirror `products.<id>.blurb` (meaning, not literal translation of English tone)

Rules:
- `live` products need `url` (external link, e.g. `https://tact.0x81.uk`)
- `soon` products: no `url`; IDE shows incubating state
- `codeLines` are decorative IDE panel content — keep syntax plausible
- Product `id` must match i18n key under `products`

## Editing copy

| Area | Files |
|------|-------|
| Hero badge/title/CTAs | `t.hero.*` in both i18n files + `Hero.astro` only if structure changes |
| IDE labels | `t.ide.*` |
| Product blurbs | `t.products.<id>.blurb` |
| Site meta | `t.site.title`, `t.site.description` |

After any i18n edit, run validation:

```bash
python3 .cursor/skills/0xindex-site/scripts/validate-i18n.py
```

## Visual constraints (do not drift)

- Background: near-black `#0a0c10`, cyan radial glow
- Accent: sky cyan (`#38bdf8` / `#7dd3fc`) — not green, not amber
- IDE surface: monospace inside panel; geometric sans for headlines
- Avoid: purple SaaS glow, empty card grids without IDE stage

## Local dev

```bash
cd 0xindex && bun install && bun run dev
```

## Checklist before finishing

- [ ] `en.json` and `zh.json` keys match (run validate script)
- [ ] Every product in `products.ts` has `products.<id>` in both i18n files
- [ ] No hardcoded user-facing strings in components
- [ ] `live` products have working external URLs
- [ ] Both `/` and `/zh` pages still compose correctly
