# crab-web (CrabBridge product site) — Design Spec

**Date:** 2026-07-14  
**Status:** Approved  
**Location:** `crab-web/`  
**Domain:** `crab.0x81.uk`  
**Brand:** CrabBridge  
**Upstream product:** [rust-infra/crab-bridge-rs](https://github.com/rust-infra/crab-bridge-rs)

## Goal

Ship a product landing page for CrabBridge with the **same stack and amber CRT / TUI visual language** as `website/` (tact).

## Decisions (locked)

| Topic | Choice |
| --- | --- |
| Stack | Astro 5 static + Bun `server.ts` |
| Port | `4322` |
| Host | `crab.0x81.uk` → `website-rs` → `crab-web:4322` |
| Language | EN `/` + ZH `/zh` (same i18n pattern as tact) |
| Visual | Reuse `retro.css` / `global.css` from tact (amber on warm black) |
| Scope | StatusBar, Nav, Hero, ValueProps, Features, Install, BridgePreview, Footer |
| Out of scope | Blog, auth, embedding the bridge binary |

## Page copy direction

- Tagline: Codex ↔ DeepSeek / Kimi bridge
- Emphasize: Responses API, streaming, keys never in toml, multi-provider path routes, desktop setup wizard
- Install: platform scripts from upstream repo + Codex `config.toml` snippet + `crabridge serve`
