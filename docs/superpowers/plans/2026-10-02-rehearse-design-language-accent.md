# 「演练语言」不再把口音当成语言取值（职演设计稿 · 屏 3）

Written against: `2c52ff0`（分支 `feat/gateway-auth`）

**Spec:** `docs/superpowers/specs/2026-10-02-rehearse-design.md` §4.2

> 本计划只改设计稿（`rehearse-app/design/index.html`），不改产品源码。执行者无需本次审计的上下文。

## Evidence chain

- Surface: `rehearse-app/design/index.html` 屏 3「场景详情」，深链 `?only=3`，标记范围 `:601–673`；具体控件是 `:626–636` 的「演练语言」分段控件
- Problem: 分段控件 `.seg`（`:627–632`）在「演练语言」标题下并列四个取值——`中文`（`:628`）/ `English (US)`（`:629`）/ `English (UK)`（`:630`）/ **`中文口音`**（`:631`）。`中文口音` 不是语言，是口音：它把 `language` 与 `persona.accent` 两个正交字段塞进同一组取值。设计稿 §4 把这套拆分称为「最重要的模型改动」，而这一屏恰好是开始演练前**唯一**需要做的决定。
- Design evidence:
  - `docs/superpowers/specs/2026-10-02-rehearse-design.md` §4 标题（`:118`）——「语言维度（**最重要的模型改动**）」
  - 同稿 §4.2（`:129–148`）——把 `persona.locale` 拆成两个正交字段 `language` 与 `persona.accent`；并在 `:148` 明确：「**`persona.accent = "zh-CN"` 这种写法废弃**——它把「口音」和「语言」混在一个字段里，是上游稿最别扭的一处」
  - 同稿 §4.2 取值表（`:145–146`）——`language` ∈ `zh-CN` / `en-US` / `en-GB` / `en-IN` / `en-AU`；`persona.accent` 取值同上或 `null`，且「`language=zh-CN` 时忽略」
  - 同稿 §4.1（`:124–125`）——被废弃的旧写法含义是「中文母语者说英文」，正是本屏 `中文口音` 想表达的东西
  - 旁证（本稿自身的一致性）：会话页头只渲染 `language` 的值——`:688` `技术深挖 · English (US)`、`:958` `HR 初筛 · 中文`，全稿没有一处把口音当语言渲染
- Owner: 屏 3 的「演练语言」`.seg`（`:627–632`），违规元素是 `:631`
- Scope and affected surfaces: 仅屏 3。屏 9 的 `.seg`（`:1125–1128`，简历 / 职位描述）与屏 12 的 `.seg`（`:1371–1375`，easy / core / challenge）都不是语言控件，不动。
- Uncertainty: 若产品决定 v1 就要让用户选口音，本计划的「直接移除」不成立——应改为「另起一个仅在 `language` 为英文时出现的口音控件」。当前证据（§4.2 把该写法判为废弃、§14 默认决策表 `:762` 只提「口音独立为 `persona.accent`」）指向 v1 不暴露口音。

## Design decision

从「演练语言」的 `.seg` 中移除 `中文口音`，让该控件只承载 `language` 的取值。口音是 `persona.accent`，且按 §4.2 仅在 `language` 为英文时生效——它不是语言的一个取值，因此不能和 `中文` / `English (US)` 并列。

保留 `English (US)` 与 `English (UK)` 两个英文取值是必要的：§4.2 说 `language` 决定 LLM 回复语言、STT `lang`、TTS 音色与纠错解释语言，英文的两个变体在这里承载的是「英音 / 美音」这一**语言变体**信息，与口音不同层级，不是同一个问题。

## Reuse

- `.seg` / `.seg button`（`index.html:203–209`）——已有分段控件，不新造
- 语言取值的既有渲染方式：会话页头 `:688`、`:958`
- Exemplar: 屏 3 自身 `:633–636` 的说明文案已经解释了「语言决定什么」，移除口音后这段文案与控件语义一致，无需改
- 若后续要暴露口音：`.seg` 已可复用，直接复用，不要新建 primitive

## Changes

1. `rehearse-app/design/index.html`（屏 3 的「演练语言」`.seg`，`:627–632`）
   - Change: 删除 `<button aria-pressed="false">中文口音</button>`（`:631`）。`.seg` 保留三个取值：`中文` / `English (US)` / `English (UK)`。
   - Preserve: `English (US)` 上的 `aria-pressed="true"`（当前选中态，`:629`）；`:633–636` 的语言说明文案（「中文纠的是表达策略，英文纠的是语言正确性」在移除口音后仍然成立）；`.seg` 上的 `style="margin-bottom:6px"`。
   - Verify: 「演练语言」下只剩三个按钮，没有一个是口音；`.seg` 内 `aria-pressed="true"` 仍恰好一个；`:633–636` 文案未变。

## Scope

- Inherit: 无。`.seg` 是通用控件，本屏改动不波及其他屏的 `.seg`。
- Verify: 屏 3 的语言说明文案在移除口音后不出现「口音」字样（当前文案没有，确认改后仍然没有），否则会出现「控件里没有口音、文案里却在讲口音」的新错位。
- Exclude:
  - `language` 枚举是否要在设计稿里补全 `en-IN` / `en-AU`（§4.2 `:145` 列了 5 个，稿里画了 3 个）——这是覆盖度问题，不是「口音当语言」问题，另议。
  - 口音控件本身（若产品决定 v1 要做）——另开一个计划，需要先定控件形态与出现条件。

## Validation

- Product: 打开 `?only=3`，确认「演练语言」只提供语言；用户不会把 `中文口音` 误读成与 `中文` 同层级的二选一。
- Interface: 浅色 / 深色各一次（`?theme=light` / `?theme=dark`）；`?only=3` 深链；390×844 竖屏。注意 `.seg button` 带 `white-space:nowrap`（`:206`），删一个按钮后三按钮在 390px 宽下不应换行，也不应出现两侧留白明显不均。
- System: 确认 `中文口音` 不再作为**语言取值**出现；该字符串若出现在说明性文案里是允许的，本稿当前只在 `:631` 出现一次。
- Repository: `grep -c '中文口音' rehearse-app/design/index.html` → 由 `1` 减为 `0`。

## Stop conditions

- 若产品确认 v1 要暴露口音选择，停止——本计划的「直接移除」不成立，改为「新增一个仅在英文语言下出现的口音控件」，需先定控件形态。
- 若发现会话页头（`:688`、`:958`）之外还有别处把口音当语言渲染，停止并回到审计——那说明混用不止一处，单屏修不干净。
- 若发现 `English (UK)` 的存在理由其实是「中文母语者的英音」这类口音语义（而不是语言变体），停止——那说明整个 `.seg` 的取值设计需要重做，不是删一个按钮能解决的。

## Design documentation

- 验收后：无需改文档。§4.2 已写明这条规则。若最终决定 v1 暴露口音，则需在 `2026-10-02-rehearse-design.md` §4.2 或 §14 默认决策表（`:762`）补一行「口音的控件位置与出现条件」。
