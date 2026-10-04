# 行首图标磁贴改用中性色（职演设计稿 · 屏 2 / 3 / 9）

Written against: `2c52ff0`（分支 `feat/gateway-auth`）

**Spec:** `rehearse-app/design/index.html` CSS 头部规则 2（`:20–29`）

> 本计划只改设计稿（`rehearse-app/design/index.html`），不改产品源码。执行者无需本次审计的上下文。

## Evidence chain

- Surface: `rehearse-app/design/index.html` 屏 2「场景选择（Tab 根页）」`:524–599`、屏 3「场景详情」`:601–673`、屏 9「材料来源」`:1103–1171`
- Problem: 同一个「行首图标磁贴」角色存在两套配色。`.scn .glyph`（`:177–180`）与 `.src .ic`（`:394–395`）用强调色系（`background:var(--accent-light)` + `color:var(--accent-text)`），而 `.row .ic`（`:432–433`）用中性色系（`background:var(--tag-bg)` + `color:var(--ink-light)`）。三者几何几乎相同（42/圆角13、40/圆角12、36/圆角11），配色差异不对应任何语义差别。
  - 后果：屏 2 上一次出现 **7 处**强调色元素——1 个 `.countdown` 填充块（`:538`）、4 个 `.scn .glyph`（`:549`、`:560`、`:569`、`:580`）、1 个 `.pill.accent`「我的」（`:551`）、1 个 `.tb.on` 激活 Tab（`:592`）。倒计时是这一屏唯一该抢注意力的东西，却被四个同色场景磁贴稀释。
- Design evidence: `rehearse-app/design/index.html` CSS 头部规则 2（`:24–26`）——「**强调色只给「正在进行 / 需要注意」的东西**：麦克风、倒计时、进度、会话页的口型与声波。结构性的容器（卡片、按钮、标签）一律中性。否则一个页面上会有两三个强调色在抢注意力，层级就塌了。」
  - 同区块规则 1（`:20–23`）是同族硬约束（`--button-bg` / `--tag-bg` / `--knob` 两套主题下都必须中性），说明这套 token 语义是本稿的契约而非风格偏好。
  - 该规则是**作者自己写在稿里的**，且已经为它付过代价（`:21–23` 记录了「之前有一版把 dark 的主按钮做成系统蓝」的返工）。
- Owner: `.scn .glyph`（`:177–180`）与 `.src .ic`（`:394–395`）
- Scope and affected surfaces:
  - `.scn .glyph` 基类命中 5 处：屏 2 的 `:549`、`:560`、`:569`、`:580`，屏 3 的 `:616`（内联覆盖）
  - `.src .ic` 基类命中 4 处：屏 3 的 `:650`，屏 9 的 `:1133`、`:1142`、`:1151`
  - 已正确的中性对照：`.row .ic` 8 处，全在屏 14 设置页（`:1459`、`:1464`、`:1469`、`:1478`、`:1483`、`:1492`、`:1497`、`:1506`）
- Uncertainty: 若产品有意用强调色磁贴区分「我的场景 / 预置场景」，则不该统一为中性，而应只给需要区分的那一个加变体。但稿里 `.scn .glyph` 对「我的场景」（`:549`）和三个预置场景（`:560`、`:569`、`:580`）用了完全相同的强调色处理，区分意图不成立。

## Design decision

把行首图标磁贴统一到中性色系，让强调色回到规则 2 枚举的那几处（麦克风、倒计时、进度、会话页口型与声波）。`.row .ic` 已经是正确实现，直接对齐它，不新造 primitive。

## Reuse

- `--tag-bg`（`:37`、`:51`）与 `--ink-light`（`:31`、`:44`）——已存在的 token，两套主题下都已定义
- Exemplar: `.row .ic`（`index.html:432–433`）——同一角色、两套主题下都正确的既有写法
- 不新建 primitive。三个磁贴的几何差异（42/13、40/12、36/11）保留现状，本计划只改配色。

## Changes

以下三处是**同一个决定**（图标磁贴用中性 token）在三个编辑点的落地。

1. `rehearse-app/design/index.html`（`:179`，`.scn .glyph`）
   - Change: `background:var(--accent-light);color:var(--accent-text);` → `background:var(--tag-bg);color:var(--ink-light);`
   - Preserve: `width:42px;height:42px;flex:0 0 auto;border-radius:13px;display:grid;place-items:center`（`:177–178`）；`.scn` 的其余部分
   - Verify: 屏 2 的四个场景磁贴变成中性底 + 中性图标，与倒计时块不再同色
2. `rehearse-app/design/index.html`（`:394`，`.src .ic`）
   - Change: `background:var(--accent-light);color:var(--accent-text);` → `background:var(--tag-bg);color:var(--ink-light);`
   - Preserve: `width:40px;height:40px;border-radius:12px;display:grid;place-items:center`
   - Verify: 屏 3 与屏 9 的来源磁贴变中性
3. `rehearse-app/design/index.html`（`:616`，屏 3 的内联覆盖）
   - Change: 从 `style` 中删除 `background:var(--accent-light);color:var(--accent-text);` 两段声明，让它继承改后的 `.scn .glyph`
   - Preserve: `width:48px;height:48px;border-radius:15px;display:grid;place-items:center`
   - Verify: 屏 3 的 Daniel 头像磁贴与屏 2 的场景磁贴同色，且尺寸仍是 48/15

## Scope

- Inherit: 所有使用 `.scn .glyph` 或 `.src .ic` 的位置（当前即上述三屏）。`.row .ic` 不变——它已经是中性。
- Verify: 屏 14 的 8 个 `.row .ic` 不受影响。其中 `:1497` 带内联 `style="color:var(--warn)"`（「清除全部本地记录」），那是**有意**的危险色，保留。
- Exclude（都不并入本计划，各自需要单独判断，不要顺手改）：
  - `.pill.accent`（`:168`）的三处用法——`:551`「我的」、`:1135`「推荐」、`:1605`「推荐」。规则 2 说「标签一律中性」，但「推荐 / 需要注意」与规则 2 的豁免项存在张力，属于独立判断。
  - `.blank .ic` 的内联强调色覆盖——`:502`（屏 1 登录，品牌标记）、`:1595`（屏 17 额度用尽，限制状态）。这两处各有状态或品牌语义；`:1535`（屏 15 空态）与 `:1565`（屏 16 权限被拒，用 `--warn`）说明该角色本来就按状态取色，与行首磁贴不是同一个问题。
  - `.switch.on`（`:438`）、`.accordion.open .ah`（`:425`）、`.tb.on`（`:450`）、`.nav .right` 的强调色内联覆盖（`:1330` 屏 12「保存」）——都是**状态**或**动作**，与「结构性容器」的判定不同。
  - `.editor .focus`（`:405`）——校对页的文本高亮，不是图标磁贴。

## Validation

- Product: 打开 `?only=2`，确认倒计时块是页面上唯一大面积的强调色块；场景磁贴退成中性后，卡片之间的层级仍然清楚（`.scn` 的卡片底、边框、圆角未变）。
- Interface: 浅色 / 深色各一次（`?theme=light` / `?theme=dark`）；`?only=2`、`?only=3`、`?only=9`；390×844 竖屏。深色主题下特别确认 `--tag-bg`（`rgba(233,237,241,.08)`）在 `--card`（`#1D2228`）上仍有可见的磁贴边界，不会糊成一片。
- System: 确认三个磁贴的几何差异被保留，只有配色统一；确认没有引入新 token；确认 `.scn .glyph` 与 `.src .ic` 的声明行不再出现 `--accent-*`。
- Repository: `grep -c 'accent-light' rehearse-app/design/index.html` → 由 `9` 减为 `6`（删除 `:179`、`:394`，以及 `:616` 内联覆盖中的那一处；剩余为 `:32`、`:45` 的 token 定义，`:168` `.pill.accent`，`:405` `.editor .focus`，`:502` 与 `:1595` 的 `.blank .ic` 覆盖）。

## Stop conditions

- 若发现产品有意用强调色磁贴区分场景归属（我的 / 预置），停止——改法应变成「只给需要区分的那一类加变体」，而不是全部中性。
- 若深色主题下中性磁贴与卡片底对比不足（`--tag-bg` 8% 白在 `--card` 上），停止并先解决对比问题，不要用回强调色了事。
- 若执行时发现还有其他屏在使用 `.scn .glyph` 或 `.src .ic`，停止并回到审计——本计划的 affected surfaces 是按 `2c52ff0` 清点的。

## Design documentation

- 验收后：无需改文档。规则 2 已写在 `rehearse-app/design/index.html` 的 CSS 头部（`:24–26`），本计划是让实现与它对齐。
- 若验收时决定「标签」也统一为中性（即处理 `.pill.accent`），则需把规则 2 的措辞收紧，说明「推荐」这类语义是否算豁免，并同步到 `2026-10-02-rehearse-design.md`。
