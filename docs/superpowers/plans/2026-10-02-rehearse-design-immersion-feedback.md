# 沉浸模式下不渲染逐轮反馈面板（职演设计稿 · 屏 7）

Written against: `2c52ff0`（分支 `feat/gateway-auth`）

**Spec:** `docs/superpowers/specs/2026-10-02-rehearse-design.md` §7.6

> 本计划只改设计稿（`rehearse-app/design/index.html`），不改产品源码。执行者无需本次审计的上下文。

## Evidence chain

- Surface: `rehearse-app/design/index.html` 屏 7「会话 · 中文演练（表达策略）」，`.slot` 第 7 个，深链 `?only=7` 可达，标记范围 `:948–1029`
- Problem: 该屏副标题声明 `第 5 / 8 轮 · 沉浸模式`（`:959`），底部模式开关也未置 `on`（`:1024` 是 `<div class="ic">`，而屏 4/5/6 都是 `<div class="ic on">`，见 `:749`、`:851`、`:934`）；但屏内 `:993–1007` 渲染了一个**展开的** `.fb` 反馈面板，含 2 条 `.fix`。沉浸模式的语义是「只聊天、不逐轮纠错」，反馈面板不该存在。
- Design evidence:
  - `docs/superpowers/specs/2026-09-27-moyan-ai-speaking-coach-design.md:35` —「逐轮反馈：AI 回复 + 更自然的说法 + 纠错 + 中文解释（**可切「沉浸模式」只聊天**）」
  - 同稿 `:287` —「`coach_mode: "immersion"` 时 `feedback` 为 `null`（省 token）」
  - 同稿 `:639` —「**反馈模式与沉浸模式都显示**（它是聊天辅助而不是纠错，所以不受「沉浸模式只聊天」那条约束）」——即只有「接下来可以怎么说」在两种模式下都保留
  - `docs/superpowers/specs/2026-10-02-rehearse-design.md` §7.6（`:482`）—「`coach_mode` | 改名 `mode`，枚举不变 `feedback` / `immersion`」，语义沿用上游稿
  - 已上线实现同此语义：`moyan-app/src/app/coach/session.tsx:646` — `const turnFeedback = mode === 'immersion' ? null : response.feedback ?? null;`；文案见 `moyan-app/src/lib/translations.ts:497` — `'Feedback gives per-turn suggestions; immersion reviews only at the end'`
- Owner: `rehearse-app/design/index.html` 屏 7 的 `.fb` 块（`:993–1007`）
- Scope and affected surfaces: 仅屏 7。屏 4 的 `.fb`（`:725–732`）、屏 5 的 `.fb`（`:820–834`）、屏 6 的 `.fb`（`:912–917`）都是反馈模式，正确；屏 18 无 `.fb`（`:1667–1669`），正确。三者都不动。
- Uncertainty: 无。

## Design decision

删除屏 7 的 `.fb` 块，只保留 `.nextlines` 面板。改完后屏 7 与三件事同时一致：它自己声明的 `沉浸模式`、底部未置 `on` 的模式开关、以及上游稿 `feedback: null` 的契约。

根因不是「少了一个 class」，而是这一屏是从屏 5 复制来的，复制时保留了反馈面板却改了模式标签。

## Reuse

- `.nextlines`（`index.html:336–350`）——沉浸模式下唯一应保留的底部面板，已存在，无需新建
- `.fb` 的两种正确状态在本屏之外已有用例：展开态见屏 5 `:820`，折叠态见屏 4 `:725`、屏 6 `:912`
- Exemplar: 屏 18 `:1667–1669` —— 同样是「本轮没有反馈」，只渲染 `.umsg > .said`，不渲染 `.fb`
- 不新建任何 primitive。

## Changes

1. `rehearse-app/design/index.html`（屏 7 的 `.umsg` 块，`:991–1008`）
   - Change: 删除 `<div class="fb">` 及其全部内容（`:993–1007`，含两个 `.fix`）。保留 `.umsg` 容器（`:991`）与 `.said`（`:992`）——用户说的那句话仍然要在。`.nextlines`（`:1010–1018`）原样保留。
   - Preserve: `.said` 的文案与 `.umsg .said` 的 `opacity:.92`；`.nextlines` 的 `.h` / `.nl` / `.spk` 结构；副标题 `第 5 / 8 轮 · 沉浸模式`；底部 `.ic` 保持不置 `on`；`.controls` 不动。
   - Verify: 屏 7 的 `.umsg` 内只剩 `.said` 一个子元素；屏 7 范围内不再出现 `.fb` / `.fbhead` / `.fix` / `.wrong` / `.right` / `.why`；「接下来可以怎么说」仍在。

## Scope

- Inherit: 无。屏 7 是独立 `.slot`，`.fb` 不在屏间共享。
- Verify: 实现阶段若把 `.fb` 的显隐绑在 `mode` 上，确认 `mode === 'immersion'` 时反馈块**整块不渲染**，而不是渲染成空壳（空壳会留下 `.fb` 的 `border-top` 与 `padding`，视觉上仍是一条多余的线）。
- Exclude: 屏 4/5/6/18 的反馈面板；`.fb` 相关 CSS（`:300–333`）不动——它仍被其他屏使用。

## Validation

- Product: 打开 `rehearse-app/design/index.html?only=7`，确认这是「沉浸模式」屏，页面上没有逐轮纠错内容，只有 AI 回复 + 用户那句话 + 「接下来可以怎么说」。
- Interface: 浅色与深色各看一次（`?theme=light` / `?theme=dark`）；`?only=7` 深链；390×844 竖屏；`.sbody` 内容变短后确认底部 `.nextlines` 与 `.controls` 不悬空、不留异常空白。
- System: 确认删除后 `.fb` 类仍被屏 4/5/6 使用，CSS 无死代码；确认没有新造 primitive。
- Repository: `grep -c 'class="fb"' rehearse-app/design/index.html` → 由 `2` 减为 `1`（剩余的是屏 5 `:820`；屏 4/6 用的是 `class="fb collapsed"`，不匹配该模式）。

## Stop conditions

- 若产品决定沉浸模式下仍要显示逐轮反馈，停止——那要改的是契约（上游稿 `:287`、`:639`）而不是本屏，且会让服务端 `feedback: null` 的省 token 设计失效。
- 若发现屏 7 的 `沉浸模式` 副标题本身是笔误（本意是 `反馈模式`），停止并回到审计——那会变成「改副标题 + 把 `.ic` 置 `on`」，与删除 `.fb` 是两种不同的改法。
- 若 `.fb` 在屏 7 之外被以「必须存在」的方式引用（例如某段脚本按序号取 `.fb`），停止。

## Design documentation

- 验收后：无需改动设计文档。上游稿 `:287` / `:639` 已经写明这条规则，本计划只是让设计稿与它对齐。
