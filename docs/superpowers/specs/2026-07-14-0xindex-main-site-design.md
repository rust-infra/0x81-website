# ai.0x81 Main Site (0xindex) — Design Spec

**Date:** 2026-07-14  
**Status:** Approved for planning  
**Location:** `0xindex/`  
**Domain:** `0x81.uk`  
**Brand:** `ai.0x81`

## Goal

Ship a modern **AI product-center homepage** for 0x81. The site is the org/product index; **tact** is the first live product (linked out to `tact.0x81.uk`), with 2–3 incubating placeholders.

## Decisions (locked)

| Topic | Choice |
| --- | --- |
| Positioning | Product center (matrix-first), brand secondary but visible |
| Brand | `ai.0x81` |
| Domain | `0x81.uk` |
| Language | Bilingual routes; **English-first copy** (`/` EN, `/zh` ZH) |
| Scope (MVP) | Single page: nav + hero + product IDE surface + light footer |
| Products | `tact` (live) + `nova` / `orbit` (coming soon placeholders) |
| Visual | Inspired by [code-pass.dev](https://code-pass.dev/): dark atmosphere, soft radial glow, status badge, large headline, **IDE-like product panel** |
| Accent | Cyan/sky (`#38bdf8` / `#7dd3fc`), not CodePass green and not tact amber |
| Stack | Astro 5 static, same deployment pattern as `website/` |
| Runtime port | **4320** |
| Out of scope | Blog, auth, pricing, embedding full tact site |

## Architecture

```
Browser → website-rs (:80)
            ├─ Host: 0x81.uk       → 0xindex:4320
            ├─ Host: tact.0x81.uk  → website:4321  (existing)
            └─ other               → website-rs handlers
```

- **App dir:** `0xindex/` (Astro project)
- **Build:** multi-stage Docker — `bun install` → `astro build` → runtime serves only `dist/` via Bun `server.ts`
- **Compose:** add `0xindex` service on `4320:4320`; `website-rs` gets `PROXY_UPSTREAM_HOST_INDEX=0xindex` (or equivalent env) and host match for `0x81.uk` (+ optional `www.0x81.uk`)
- **Product links:** tact CTA / IDE open action → external `https://tact.0x81.uk`
- **Data:** `src/data/products.ts` for product catalog; `src/i18n/en.json` + `zh.json` for strings

## Page structure

Single composition first viewport:

1. **Nav** — brand `ai.0x81`, Products anchor, EN/中文 switch, GitHub
2. **Hero** — status badge, English primary headline + short subtitle, CTAs (`Open tact`, `Browse matrix`)
3. **Product surface (IDE window)** — Explorer list, file tabs, code panel for selected product, terminal strip; switching `nova`/`orbit` shows incubating state (no outbound link)
4. **Footer** — minimal copyright / domain links (below fold OK)

### English-first copy direction

- Badge: `v0.1 · tact live · nova / orbit incubating`
- Title: `AI products, indexed.`
- Subtitle: `One catalog. Many runtimes. Start with tact — a terminal-first coding agent.`
- CTAs: `Open tact` / `Browse matrix`
- Chinese route mirrors meaning; does not drive tone

## Visual system

- **Background:** near-black `#0a0c10` with restrained cyan radial glow + subtle grain/dot texture
- **Accent:** sky cyan for badge, active tab, CTA, selected explorer item
- **Typography:** strong geometric sans for brand/headline; monospace inside IDE surface (e.g. JetBrains Mono)
- **Motion (2–3):** badge pulse, IDE panel entrance, tab/product cross-fade
- **Avoid:** purple SaaS glow, cream+terracotta editorial, newspaper broadsheet, empty card grids without the IDE stage

## Components (logical)

| Unit | Responsibility |
| --- | --- |
| `BaseLayout` | HTML shell, fonts, lang, global CSS variables |
| `Nav` | Brand, anchors, locale switch, GitHub |
| `Hero` | Badge, headline, subtitle, CTAs |
| `ProductMatrixIDE` | Explorer + tabs + code/terminal panel; local UI state only |
| `Footer` | Light closing strip |
| `products.ts` | Catalog entries: id, status, stack, url?, i18n keys |

## Error / edge behavior

- Unknown locale path → Astro static 404
- Incubating product selected → panel shows coming-soon copy; primary CTA disabled or hidden
- Proxy misconfig → `website-rs` 502; healthcheck remains on `/health` of `website-rs`

## Testing (MVP)

- Local: `bun run build && bun run start` on 4320; `/` and `/zh` render
- Compose: `0x81.uk` Host header (or local hosts entry) reaches index; tact host still reaches `website`
- Visual smoke: accent cyan present; IDE panel visible on desktop and stacks acceptably on mobile (explorer collapses or stacks)

## Non-goals reminder

No CMS, no blog, no account system, no pricing tables in v1.
