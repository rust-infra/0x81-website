# ai.0x81 Main Site (0xindex) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `0xindex/` Astro static main site for `ai.0x81` on `0x81.uk:4320`, with CodePass-inspired dark cyan UI, IDE product matrix, EN-first bilingual pages, and `website-rs` host routing.

**Architecture:** New Astro app in `0xindex/` mirrors `website/` deploy pattern (Bun build → Bun static `server.ts`). `website-rs` proxies `0x81.uk` / `www.0x81.uk` to `0xindex:4320`. Product catalog is data-driven; tact links out to `https://tact.0x81.uk`.

**Tech Stack:** Astro 5, TypeScript, Bun, Docker Compose, Axum (`website-rs`)

**Spec:** `docs/superpowers/specs/2026-07-14-0xindex-main-site-design.md`

---

## File map

| Path | Responsibility |
| --- | --- |
| `0xindex/package.json` | Scripts + Astro dependency |
| `0xindex/astro.config.mjs` | site `https://0x81.uk`, static, `trailingSlash: "never"` |
| `0xindex/tsconfig.json` | Astro TS config |
| `0xindex/server.ts` | Bun static file server on port **4320** |
| `0xindex/Dockerfile` | Multi-stage build + runtime |
| `0xindex/.dockerignore` | Ignore node_modules/dist |
| `0xindex/.gitignore` | node_modules/dist/.astro |
| `0xindex/public/favicon.svg` | Brand mark |
| `0xindex/src/styles/global.css` | Tokens, atmosphere, motion |
| `0xindex/src/data/products.ts` | Product catalog |
| `0xindex/src/i18n/en.json` | English strings (primary) |
| `0xindex/src/i18n/zh.json` | Chinese strings |
| `0xindex/src/layouts/BaseLayout.astro` | Shell + fonts + CSS |
| `0xindex/src/components/Nav.astro` | Brand / anchors / locale / GitHub |
| `0xindex/src/components/Hero.astro` | Badge / title / CTAs |
| `0xindex/src/components/ProductMatrixIDE.astro` | IDE explorer + tabs + code + terminal |
| `0xindex/src/components/Footer.astro` | Light footer |
| `0xindex/src/pages/index.astro` | EN page |
| `0xindex/src/pages/zh/index.astro` | ZH page |
| `docker-compose.yml` | Add `0xindex` service |
| `website-rs/src/main.rs` | Host route for `0x81.uk` |

---

### Task 1: Scaffold `0xindex` Astro project + Bun server

**Files:**
- Create: `0xindex/package.json`
- Create: `0xindex/astro.config.mjs`
- Create: `0xindex/tsconfig.json`
- Create: `0xindex/.gitignore`
- Create: `0xindex/server.ts`
- Create: `0xindex/src/pages/index.astro` (minimal placeholder)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "0xindex",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "scripts": {
    "dev": "astro dev --port 4320",
    "build": "astro build",
    "preview": "astro preview --port 4320",
    "start": "bun run server.ts"
  },
  "dependencies": {
    "astro": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create astro.config.mjs**

```js
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://0x81.uk",
  output: "static",
  trailingSlash: "never",
});
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "extends": "astro/tsconfigs/strict"
}
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
.astro/
```

- [ ] **Step 5: Create server.ts (port 4320)**

Copy pattern from `website/server.ts`, change default port:

```ts
import { join } from "node:path";
import { file, serve } from "bun";

const root = join(import.meta.dir, "dist");
const port = Number(process.env.PORT ?? 4320);

async function resolveFile(pathname: string) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = [
    rel,
    join(rel, "index.html"),
    rel.endsWith(".html") ? rel : `${rel}.html`,
  ].map((entry) => join(root, entry));

  for (const path of candidates) {
    const entry = file(path);
    if (await entry.exists()) {
      return entry;
    }
  }
  return null;
}

serve({
  port,
  hostname: "0.0.0.0",
  async fetch(req) {
    const entry = await resolveFile(new URL(req.url).pathname);
    if (entry) return new Response(entry);
    return new Response("Not Found", { status: 404 });
  },
});
```

- [ ] **Step 6: Create minimal page**

`0xindex/src/pages/index.astro`:

```astro
---
---
<html lang="en">
  <head><meta charset="utf-8" /><title>ai.0x81</title></head>
  <body><h1>ai.0x81</h1></body>
</html>
```

- [ ] **Step 7: Install + build smoke**

Run:

```bash
cd 0xindex && bun install --registry=https://registry.npmmirror.com && bun run build
```

Expected: `dist/index.html` exists; build completes without error.

- [ ] **Step 8: Commit**

```bash
git add 0xindex
git commit -m "Scaffold 0xindex Astro app with Bun static server on 4320."
```

---

### Task 2: Product data + i18n strings

**Files:**
- Create: `0xindex/src/data/products.ts`
- Create: `0xindex/src/i18n/en.json`
- Create: `0xindex/src/i18n/zh.json`

- [ ] **Step 1: Create products.ts**

```ts
export type ProductStatus = "live" | "soon";

export interface Product {
  id: string;
  status: ProductStatus;
  stack: string;
  fileName: string;
  url?: string;
  codeLines: string[];
}

export const products: Product[] = [
  {
    id: "tact",
    status: "live",
    stack: "rust · mcp · terminal",
    fileName: "tact.tsx",
    url: "https://tact.0x81.uk",
    codeLines: [
      "export const product = {",
      "  id: 'tact',",
      "  status: 'live',",
      "  stack: 'rust · mcp · terminal',",
      "  url: 'https://tact.0x81.uk',",
      "}",
    ],
  },
  {
    id: "nova",
    status: "soon",
    stack: "inference gateway",
    fileName: "nova.ts",
    codeLines: [
      "export const product = {",
      "  id: 'nova',",
      "  status: 'incubating',",
      "  stack: 'inference gateway',",
      "}",
    ],
  },
  {
    id: "orbit",
    status: "soon",
    stack: "evals & traces",
    fileName: "orbit.ts",
    codeLines: [
      "export const product = {",
      "  id: 'orbit',",
      "  status: 'incubating',",
      "  stack: 'evals & traces',",
      "}",
    ],
  },
];
```

- [ ] **Step 2: Create en.json**

```json
{
  "site": {
    "title": "ai.0x81 — AI product index",
    "description": "One catalog. Many runtimes. Start with tact — a terminal-first coding agent."
  },
  "nav": {
    "products": "Products",
    "github": "GitHub",
    "lang_other": "中文"
  },
  "hero": {
    "badge": "v0.1 · tact live · nova / orbit incubating",
    "title": "AI products, indexed.",
    "subtitle": "One catalog. Many runtimes. Start with tact — a terminal-first coding agent.",
    "cta_tact": "Open tact",
    "cta_matrix": "Browse matrix"
  },
  "ide": {
    "window_title": "ai.0x81 — matrix",
    "explorer": "EXPLORER",
    "products": "PRODUCTS",
    "routes": "ROUTES",
    "ready": "Ready",
    "live": "LIVE",
    "soon": "SOON",
    "open_product": "Open product →",
    "coming_soon": "Incubating — not public yet.",
    "terminal_tact": "$ open tact.0x81.uk",
    "terminal_soon": "$ waiting for release"
  },
  "footer": {
    "line": "ai.0x81 · 0x81.uk"
  },
  "products": {
    "tact": {
      "blurb": "Terminal-first AI coding agent. Rust. MCP. Self-hosted."
    },
    "nova": {
      "blurb": "Inference gateway — coming soon."
    },
    "orbit": {
      "blurb": "Evals and traces — coming soon."
    }
  }
}
```

- [ ] **Step 3: Create zh.json**

Mirror keys; keep tone secondary to English. Example hero:

```json
{
  "site": {
    "title": "ai.0x81 — AI 产品索引",
    "description": "一个目录，多个 runtime。从 tact 开始 —— 终端优先的 coding agent。"
  },
  "nav": {
    "products": "产品",
    "github": "GitHub",
    "lang_other": "English"
  },
  "hero": {
    "badge": "v0.1 · tact 已上线 · nova / orbit 孵化中",
    "title": "AI 产品，集中索引。",
    "subtitle": "一个目录，多个 runtime。从 tact 开始 —— 终端优先的 coding agent。",
    "cta_tact": "打开 tact",
    "cta_matrix": "浏览矩阵"
  },
  "ide": {
    "window_title": "ai.0x81 — matrix",
    "explorer": "EXPLORER",
    "products": "PRODUCTS",
    "routes": "ROUTES",
    "ready": "Ready",
    "live": "LIVE",
    "soon": "SOON",
    "open_product": "打开产品 →",
    "coming_soon": "孵化中 — 尚未公开。",
    "terminal_tact": "$ open tact.0x81.uk",
    "terminal_soon": "$ waiting for release"
  },
  "footer": {
    "line": "ai.0x81 · 0x81.uk"
  },
  "products": {
    "tact": {
      "blurb": "终端优先的 AI coding agent。Rust · MCP · 本地自托管。"
    },
    "nova": {
      "blurb": "推理网关 — 即将推出。"
    },
    "orbit": {
      "blurb": "评测与链路追踪 — 即将推出。"
    }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add 0xindex/src/data 0xindex/src/i18n
git commit -m "Add 0xindex product catalog and EN/ZH copy."
```

---

### Task 3: Global styles + BaseLayout + favicon

**Files:**
- Create: `0xindex/src/styles/global.css`
- Create: `0xindex/src/layouts/BaseLayout.astro`
- Create: `0xindex/public/favicon.svg`

- [ ] **Step 1: Create global.css with design tokens**

Include at minimum:

```css
:root {
  --bg: #0a0c10;
  --fg: #eceff4;
  --muted: #8b93a3;
  --accent: #38bdf8;
  --accent-bright: #7dd3fc;
  --panel: #0e1218;
  --panel-2: #121722;
  --border: rgba(255, 255, 255, 0.1);
  --font-sans: "Geist", "SF Pro Display", "Segoe UI", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
}

html, body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-sans);
}

/* Atmosphere: cyan radial + subtle dots */
.page-bg {
  min-height: 100vh;
  background:
    radial-gradient(ellipse 65% 50% at 50% 28%, rgba(56, 189, 248, 0.11), transparent 60%),
    linear-gradient(180deg, #10141b 0%, #0a0c10 60%, #07090d 100%);
}

@keyframes badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

@keyframes ide-enter {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
```

Also style nav, hero, IDE panel, footer, mobile stack rules (explorer above editor under ~720px).

- [ ] **Step 2: Create BaseLayout.astro**

```astro
---
import "../styles/global.css";
export interface Props {
  title: string;
  description: string;
  lang?: string;
}
const { title, description, lang = "en" } = Astro.props;
---
<!doctype html>
<html lang={lang}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content={description} />
    <title>{title}</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div class="page-bg">
      <slot />
    </div>
  </body>
</html>
```

If Geist is unavailable on Google Fonts in the environment, fall back to `Syne` + `JetBrains Mono` and update `--font-sans` accordingly.

- [ ] **Step 3: Create favicon.svg**

Simple `0x` mark on dark rounded square with cyan border.

- [ ] **Step 4: Commit**

```bash
git add 0xindex/src/styles 0xindex/src/layouts 0xindex/public
git commit -m "Add 0xindex layout, tokens, and favicon."
```

---

### Task 4: Nav + Hero + Footer components

**Files:**
- Create: `0xindex/src/components/Nav.astro`
- Create: `0xindex/src/components/Hero.astro`
- Create: `0xindex/src/components/Footer.astro`

- [ ] **Step 1: Nav.astro**

Props: `t`, `currentLang` (`en` | `zh`).  
Locale switch: EN page links to `/zh`, ZH page links to `/`.  
GitHub: `https://github.com/rust-infra` (or org URL used elsewhere).  
Products → `#matrix`.

- [ ] **Step 2: Hero.astro**

Render badge (with `.badge-dot` pulse), title, subtitle, CTAs:
- Primary: `<a href="https://tact.0x81.uk">` using `t.hero.cta_tact`
- Secondary: `<a href="#matrix">` using `t.hero.cta_matrix`

- [ ] **Step 3: Footer.astro**

Minimal `t.footer.line`.

- [ ] **Step 4: Commit**

```bash
git add 0xindex/src/components/Nav.astro 0xindex/src/components/Hero.astro 0xindex/src/components/Footer.astro
git commit -m "Add 0xindex nav, hero, and footer."
```

---

### Task 5: ProductMatrixIDE component

**Files:**
- Create: `0xindex/src/components/ProductMatrixIDE.astro`

- [ ] **Step 1: Implement IDE markup**

Structure:
- Window chrome (traffic lights + `t.ide.window_title` + Ready)
- Left Explorer: PRODUCTS list from `products`, ROUTES (`0x81.uk`, `tact.0x81.uk`)
- Tabs from `products[].fileName`
- Code panel: line-numbered `codeLines` for active product
- Blurb from `t.products[id].blurb`
- If status `live` and `url`: show open link; if `soon`: show `t.ide.coming_soon`
- Terminal strip: tact vs soon command

Use `id="matrix"` on the section root.

- [ ] **Step 2: Client script for selection**

Inline `<script>`:
- Click explorer item or tab → set `data-active` on matching panels
- Cross-fade via CSS class toggle
- Default active: `tact`

- [ ] **Step 3: Entrance motion**

Apply `animation: ide-enter 0.5s ease both` on the IDE window.

- [ ] **Step 4: Commit**

```bash
git add 0xindex/src/components/ProductMatrixIDE.astro
git commit -m "Add IDE-style product matrix for 0xindex."
```

---

### Task 6: Wire EN + ZH pages

**Files:**
- Modify: `0xindex/src/pages/index.astro`
- Create: `0xindex/src/pages/zh/index.astro`

- [ ] **Step 1: EN page**

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import Nav from "../components/Nav.astro";
import Hero from "../components/Hero.astro";
import ProductMatrixIDE from "../components/ProductMatrixIDE.astro";
import Footer from "../components/Footer.astro";
import en from "../i18n/en.json";
import { products } from "../data/products";
const t = en;
---
<BaseLayout title={t.site.title} description={t.site.description} lang="en">
  <Nav {t} currentLang="en" />
  <Hero {t} />
  <ProductMatrixIDE {t} {products} />
  <Footer {t} />
</BaseLayout>
```

- [ ] **Step 2: ZH page** — same with `zh.json`, `lang="zh"`, `currentLang="zh"`.

- [ ] **Step 3: Build + verify**

```bash
cd 0xindex && bun run build
test -f dist/index.html && test -f dist/zh/index.html
```

Expected: both files exist; HTML contains `AI products, indexed.` and Chinese title string.

- [ ] **Step 4: Local serve smoke**

```bash
cd 0xindex && bun run start &
sleep 1
curl -sI http://127.0.0.1:4320/ | head -1
curl -sI http://127.0.0.1:4320/zh | head -1
kill %1
```

Expected: `HTTP/1.1 200` for both.

- [ ] **Step 5: Commit**

```bash
git add 0xindex/src/pages
git commit -m "Wire EN and ZH pages for 0xindex main site."
```

---

### Task 7: Dockerize `0xindex`

**Files:**
- Create: `0xindex/Dockerfile`
- Create: `0xindex/.dockerignore`

- [ ] **Step 1: Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1

ARG BASE_IMAGE=docker.m.daocloud.io/oven/bun:1-alpine

FROM ${BASE_IMAGE} AS build
WORKDIR /app
RUN sed -i 's#https\?://dl-cdn.alpinelinux.org#https://mirrors.aliyun.com#g' /etc/apk/repositories
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --registry=https://registry.npmmirror.com
COPY . .
RUN bun run build

FROM ${BASE_IMAGE}
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server.ts ./
ENV PORT=4320
EXPOSE 4320
CMD ["bun", "run", "server.ts"]
```

Note: after first `bun install`, ensure `bun.lockb` is committed (Task 1 already installed).

- [ ] **Step 2: .dockerignore**

```
node_modules
dist
.astro
.git
.gitignore
*.md
package-lock.json
.dockerignore
```

- [ ] **Step 3: Commit**

```bash
git add 0xindex/Dockerfile 0xindex/.dockerignore 0xindex/bun.lockb
git commit -m "Add Docker build for 0xindex on port 4320."
```

---

### Task 8: Compose + website-rs host routing

**Files:**
- Modify: `docker-compose.yml`
- Modify: `website-rs/src/main.rs`

- [ ] **Step 1: Update docker-compose.yml**

Add service:

```yaml
  0xindex:
    build: ./0xindex
    ports:
      - "4320:4320"
    restart: unless-stopped
```

Update `website-rs`:

```yaml
    environment:
      - RUST_LOG=info
      - PROXY_UPSTREAM_HOST_TACT=website
      - PROXY_UPSTREAM_HOST_INDEX=0xindex
    depends_on:
      - website
      - 0xindex
```

- [ ] **Step 2: Extend proxy_or_next in main.rs**

Strip port from host if present (`0x81.uk:80` → `0x81.uk`). Match:

```rust
let host = host.split(':').next().unwrap_or(&host);

if host == "tact.0x81.uk" {
    let upstream = proxy_upstream_host("PROXY_UPSTREAM_HOST_TACT");
    proxy_request(req, &upstream, 4321).await
} else if host == "0x81.uk" || host == "www.0x81.uk" {
    let upstream = proxy_upstream_host("PROXY_UPSTREAM_HOST_INDEX");
    proxy_request(req, &upstream, 4320).await
} else {
    next.run(req).await
}
```

Keep existing `Host: localhost:4320` override behavior when forwarding (already sets `host` header to localhost:port).

- [ ] **Step 3: cargo check**

```bash
cd website-rs && cargo check
```

Expected: success (warnings OK).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml website-rs/src/main.rs
git commit -m "Route 0x81.uk to 0xindex via website-rs and Compose."
```

---

### Task 9: End-to-end verification

- [ ] **Step 1: Compose build**

```bash
docker compose up -d --build 0xindex website-rs
```

- [ ] **Step 2: Direct port check**

```bash
curl -sI http://127.0.0.1:4320/ | head -1
curl -s http://127.0.0.1:4320/ | rg -o "AI products, indexed\\." | head -1
```

Expected: `200` and headline present.

- [ ] **Step 3: Host-header proxy check**

```bash
curl -sI -H "Host: 0x81.uk" http://127.0.0.1/ | head -1
curl -s -H "Host: 0x81.uk" http://127.0.0.1/ | rg -o "AI products, indexed\\." | head -1
curl -sI -H "Host: tact.0x81.uk" http://127.0.0.1/ | head -1
```

Expected: index returns 200 with headline; tact host still proxies (not 502).

- [ ] **Step 4: Final commit if polish needed; push only if user asks**

---

## Spec coverage check

| Spec item | Task |
| --- | --- |
| `0xindex/` Astro static | 1, 6 |
| Port 4320 | 1, 7, 8 |
| EN-first + `/zh` | 2, 6 |
| CodePass-like dark cyan + IDE | 3, 5 |
| tact live + nova/orbit soon | 2, 5 |
| tact → tact.0x81.uk | 4, 5 |
| Compose + website-rs host | 8, 9 |
| No blog/auth/pricing | honored (not in tasks) |

## Self-review notes

- No TBD placeholders.
- Proxy env names: `PROXY_UPSTREAM_HOST_INDEX` / `PROXY_UPSTREAM_HOST_TACT` consistent across Task 8.
- Port **4320** used everywhere (server, Docker EXPOSE, compose, Rust proxy).
