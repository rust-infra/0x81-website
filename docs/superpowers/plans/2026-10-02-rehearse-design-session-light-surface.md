# 浅色主题给会话页一套浅色面（职演设计稿 · 屏 4/5/6/7/18）

Written against: `2c52ff0`（分支 `feat/gateway-auth`）

**Spec:** `docs/superpowers/specs/2026-10-02-rehearse-design.md`；上游 `docs/superpowers/specs/2026-09-27-moyan-ai-speaking-coach-design.md:659`

> 本计划只改设计稿（`rehearse-app/design/index.html`），不改产品源码。执行者无需本次审计的上下文。

## Evidence chain

- Surface: `rehearse-app/design/index.html` 中带 `.screen session` 的 **5 屏**——屏 4 会话·倾听（`:685`）、屏 5 会话·思考（`:784`）、屏 6 会话·说话（`:872`）、屏 7 会话·中文演练（`:955`）、屏 18 服务不可用（`:1633`）
- Problem: `--study-*` 在**两套主题下都是深色**。浅色主题下打开这 5 屏，看到的仍是近黑面：

  | token | light（`:35–36`） | dark（`:49–50`） | 差 |
  |---|---|---|---|
  | `--study-text` | `#E9EDF1` | `#E9EDF1` | **完全相同** |
  | `--study-accent` | `#6FA3D9` | `#6FA3D9` | **完全相同** |
  | `--study-bg` | `#12161A` | `#0D1114` | 5/255 |
  | `--study-card` | `#1C2228` | `#171C21` | 5–7/255 |
  | `--study-muted` | `rgba(233,237,241,.62)` | `rgba(233,237,241,.58)` | .04 alpha |
  | `--study-on-accent` | `#10151A` | `#0B1014` | ~5/255 |

  后果一：主题开关在这 5 屏上近乎空转——文字与强调色一个字节都不变，底色只差 2%。
  后果二（更关键）：**流程被切开**。屏 3 场景详情是 `.screen`（浅）→ 屏 4–7 是 `.screen session`（恒黑）→ 屏 8 总结是 `.screen`（浅）。深色主题下三屏连贯；浅色主题下是「浅 → 黑 → 浅」，在一次任务中间断层。
- Design evidence:
  - 设计板自己的承诺：`index.html:479–480`——「**只做浅色 / 深色两套**，色相完全对齐（强调色都是 210°），切换时是「同一套设计换明暗」而不是换设计」。当前对 5/18 屏为假。
  - `docs/superpowers/specs/2026-10-02-rehearse-design.md:753`（视觉验收）——「Rehearse 与墨言各自在浅色 / 深色主题下截图，确认两套视觉同族但不互相依赖」。浅色主题下截会话页会得到一张深色图，这条验收无从执行。
  - 现状的理由是循环的：`index.html:34` 写「会话页是深色沉浸面，浅色主题的 `--accent` 压上去只有 2.3:1，必须换一套」——页面之所以需要 `--study-accent`，是因为先把它定成了深色；跟随主题后 `--accent` 本来就够用（浅色主题的 `--accent-fill:#2F5D8C` 配 `--on-accent:#FFFFFF` 是 6.85:1，见 `:33`）。
  - 上游稿 `:659` 是当初这么定的依据（「Study 页已经在用这套深色沉浸面，所以它属于应用既有语言」）。该依据不再成立：Rehearse 是独立产品，`:9–14` 已明确「职演有自己的配色，**不沿用墨言的水墨体系**」。
- Owner: `rehearse-app/design/index.html` 的 `[data-theme="light"]` 块（`:30–42`）里的 `--study-*` 六行（`:35–36`），以及 `.session` 规则（`:214–219`）
- Scope and affected surfaces: 5 个 `.screen session` 屏的全部内部组件；外加 `--study-muted` 的 **22 处消费**（14 处文字 + 8 处描边；`:226` 一行同时兼做两者，所以落在 21 行上）
- Uncertainty: 无。深色主题渲染必须逐字节不变，这一点有明确验收方式（见 Validation）。

## Design decision

浅色主题下把 `--study-*` 指向**该主题自己的既有 token**，让会话页成为浅色面；深色主题一个字节不改。

关键判断：`--study-muted` 现在**同时承担文字色与描边色两个角色**（14 处文字 / 8 处描边）。深色下这不冲突——浅色墨在深底上，58% alpha 既能当弱化文字、又能当一条可见的发丝线。但极性翻转后同一个值无法兼顾：要当弱化文字需要约 `#676E78`，要当描边则比全站 `--border:#E3E6EA` 重 4 倍。所以**必须把描边角色拆出来**，新增一个 `--study-line`。

这不是新造 primitive，而是把一个被合并的 token 按角色拆开；深色下 `--study-line` 取当前 `--study-muted` 的值，因此深色渲染完全不变。

## Reuse

全部取值来自浅色主题**已有的** token，不发明任何色值：

| token | 浅色新值 | 来源 |
|---|---|---|
| `--study-bg` | `#F4F5F7` | = `--paper`（`:31`） |
| `--study-card` | `#FFFFFF` | = `--card`（`:31`） |
| `--study-text` | `#1A1D21` | = `--ink`（`:31`） |
| `--study-muted` | `#676E78` | = `--ink-muted`（`:31`） |
| `--study-line` | `#E3E6EA` | = `--border`（`:32`）**← 新增** |
| `--study-accent` | `#2F5D8C` | = `--accent`（`:32`） |
| `--study-on-accent` | `#FFFFFF` | = `--on-accent`（`:33`） |

深色（`:49–50`）只增一行 `--study-line:rgba(233,237,241,.58)`，其余原样。

- Exemplar: `.card` / `.btn.ghost` / `.row` 就是浅色主题下「卡片 + 发丝描边 + 弱化文字」的既有写法（`:154`、`:160`、`:428–436`），会话页对齐它们即可。
- `.session` 的 accent 重映射（`:216–218`）**保留**。改动后浅色下 `--study-accent` 与 `--accent` 取值相同、重映射成为等价，但保留这层间接是有意的接缝：将来单独调会话页的强调色不必去动每一条声明。**不要在本次一并删除它。**

## Changes

1. `rehearse-app/design/index.html`（`:35–36`，浅色主题的 `--study-*` 块）
   - Change: 按上表替换为浅色值，并新增 `--study-line:#E3E6EA;`
   - Preserve: 同一行的 `--study-accent` / `--study-on-accent` 字段顺序；`:36` 上的注释（需按第 3 条改写）
   - Verify: 浅色主题下会话页底色为 `#F4F5F7`、卡片为 `#FFFFFF`、正文为 `#1A1D21`
2. `rehearse-app/design/index.html`（`:50`，深色主题）
   - Change: 只追加 `--study-line:rgba(233,237,241,.58);`
   - Preserve: `:50` 上其余六个 token 的**每一个字节**
   - Verify: 深色主题下 5 屏的渲染与改动前逐像素一致（`--study-line` 与 `--study-muted` 取值相同）
3. `rehearse-app/design/index.html`（注释，4 处）——这些注释写明了对比度数字，前提都是深色面，不改就变成假话：
   - `:34`——删掉「浅色主题的 `--accent` 压上去只有 2.3:1，必须换一套」这句循环理由，改为说明会话页两套主题各自跟随本主题的 token
   - `:211–213`——同上；`.session` 规则本身（`background`/`color`/三条 accent 重映射）不动
   - `:281–283`——原文「13.6:1 → 6.0:1」与「中文对照不能跟着降透明度……只有 62% alpha」按新值重算：浅色下 `--study-text` 对 `--study-bg` 为 15.50:1，`--study-muted` 对 `--study-bg` 为 4.72:1；**并注明「双层透明度」这个坑只在深色主题成立**（浅色下 `--study-muted` 已是不透明色）。⚠️ 重算时沿用作者的方法：**两套主题各算一次，写较差的那个**——原文的 13.6 就是 `#E9EDF1` 落在较暗的浅色 `--study-card:#1C2228` 上的值（深色 `#171C21` 上是 14.58），6.0 是深色的 5.97。
   - `:293–295`——原文「.5 在浅色主题上只有 4.47:1，.62 两套都过」按新值重算：浅色下 `.62` 的 interim 文字对白卡为 4.76:1（仍达 AA）。
4. `rehearse-app/design/index.html`（8 处描边声明，`--study-muted` → `--study-line`）
   - Change: `:226`（`.shead .end` 的 `border`）、`:266`（`.mic-ring`）、`:300`（`.fb` 的 `border-top`）、`:337`（`.nextlines` 的 `border-top`）、`:355`（`.controls` 的 `border-top`）、`:361`（`.controls .mic.off`）、`:364`（`.controls .ic`）、`:1657`（屏 18 内联的 `border-color`）
   - Preserve: `:226` 该行里的 `color:var(--study-muted)`（那是**文字**角色，保留）；其余声明只换 token 名
   - Verify: 用 `grep -nE 'border[a-z-]*:[^;]*var\(--study-muted\)' index.html` 复查——改动前 8 行，改动后无输出（该正则的验证方式与假阳性说明见 Validation → Repository）

## Scope

- Inherit: 5 个 `.screen session` 屏的全部内部组件自动跟随（`.shead` / `.avatar-tile` / `.avatar` / `.subtitle` / `.umsg` / `.fb` / `.nextlines` / `.controls` / `.state-note`），无需逐个改。
- Verify:
  - **`.avatar` 的 SVG**（`:239–244`）：`.stroke` / `.eye` / `.mouth` 用 `stroke:var(--study-text);opacity:.9`，浅色下变成 `#1A1D21` 在 90%——在白卡上必须仍然清晰；`.ring` / `.wave` / `.dots` 用 `var(--accent)`，经 `.session` 重映射后为 `#2F5D8C`。
  - **`.mic-ring`（`:264–272`）与 `.controls .ic`（`:362–365`）**：这两个是**描边控件**，不是分隔线。浅色下描边为 `#E3E6EA`（对白卡 1.25:1），会相当淡。这与全站 `.btn.ghost`（`:160`，同样 `--border`）一致，属于应用既有观感，不是本计划引入的退化——但必须**实际看一眼**再决定是否接受。
  - **屏 18 的透明度**（`:1642` `.avatar-tile{opacity:.42}`、`:1668` `.said{opacity:.72}`、`:1671` `.nextlines{opacity:.55}`）：在深底上「变淡」是往黑里退，在浅底上变成往白里退，观感不同。必须单独确认这三处仍读得出「降级」而不是「消失」。
- Exclude:
  - `.countdown`（`:187–200`）——在屏 2，属 `.screen` 而非 `.session`，用的是主题自己的 `--accent-fill`/`--on-accent`，与本次无关；`:196–197` 那条注释不动。
  - 删除 `--study-accent` / `--study-on-accent` 或 `.session` 的三条重映射——见 Design decision 末尾，有意保留。
  - 给 `.avatar-tile` 补边框、调整任何间距/尺寸——本次只做配色与主题跟随。
  - 屏 1–3、8–17 的任何改动。

## Validation

- Product: 浅色主题下走一遍完整任务——屏 3 场景详情 → 屏 4 会话（点「播放一轮」跑完倾听→思考→反馈展开→说话→回到倾听）→ 屏 8 总结。确认全程**没有黑屏断层**，且会话页的正文、字幕、反馈、控制条在浅色下都可读。
- Interface: 两套主题各走一遍（`?theme=light` / `?theme=dark`）；5 个会话屏的深链 `?only=4`、`?only=5`、`?only=6`、`?only=7`、`?only=18`；`?demo=play` 自动跑一轮；390×844 竖屏。
- System:
  - 确认没有新增 primitive，只新增一个按角色拆出的 `--study-line`；
  - 确认 `--study-muted` 不再出现在任何 `border` / `border-color` 声明里；
  - 确认 `.session` 的 accent 重映射仍在（不要顺手删掉）。
- Repository:
  - `grep -nE 'border[a-z-]*:[^;]*var\(--study-muted\)' rehearse-app/design/index.html` → 改动前 **8** 行（`:226` `:266` `:300` `:337` `:355` `:361` `:364` `:1657`），改动后 **无输出**。
    ⚠️ 不要用 `grep 'study-muted' | grep 'border'`：它会多匹配一行 `:286`（`.subtitle .tools button` 的 `background:none;border:none;color:var(--study-muted)`）——那行的 `border:none` 与 `--study-muted` 无关；改动后 `:226` 也会因为同行的 `color:var(--study-muted)` 而继续匹配。上面的正则只匹配「border 声明里消费了 `--study-muted`」，已验证无假阳性。
  - `grep -c 'study-muted' rehearse-app/design/index.html` → 由 `25` 减为 `18`。差额是 7：8 处描边消费里有 7 处（`:266` `:300` `:337` `:355` `:361` `:364` `:1657`）整行不再含 `--study-muted`；`:226` 因为同一行还有 `color:var(--study-muted)`，仍计数。
  - `grep -c 'study-line' rehearse-app/design/index.html` → `10`（2 处定义 + 8 处消费）
  - `git diff --stat rehearse-app/design/index.html` → 只有这一个文件
  - 深色主题回归：把 `:50` 的 diff 单独看一遍，确认只有追加的 `--study-line` 一行，六个旧 token 未动

## Stop conditions

- 若深色主题下 5 屏出现任何渲染变化，停止——`--study-line` 必须与深色原 `--study-muted` 取值完全相同。
- 若发现 `--study-muted` 还有第三个角色（例如被用作背景色），停止并回到审计——那说明拆两个角色还不够。
- 若 `.mic-ring` / `.controls .ic` 的描边在浅色下淡到「控件看起来不存在」，停止，不要用回深色值了事——应作为一条**新发现**记录（这是浅色主题 `--border` 本身偏淡的问题，影响 `.btn.ghost` 等既有组件，不属于本计划）。
- 若产品希望浅色会话面**保留一点沉浸感**（例如比 `--paper` 更灰一档，而不是直接等于 `--paper`），停止——那需要先定一个新色值，与「只复用既有 token」的约束冲突，需要单独拍板。

## Design documentation

- 验收后需在设计文档记录这次决策，因为它是**撤销**了一条既有结论：
  - `docs/superpowers/specs/2026-09-27-moyan-ai-speaking-coach-design.md:659`（「会话页 → studyBg/studyCard/studyText/studyMuted……属于应用既有语言」）——加一条注记，说明 Rehearse 独立后不再沿用，会话页跟随本主题。
  - `docs/superpowers/specs/2026-10-02-rehearse-design.md` §14 默认决策表——补一行「会话页主题：跟随 light / dark，不做恒深色沉浸面」。
- `rehearse-app/design/index.html:479–480` 的措辞**不需要改**：改完后它对全部 18 屏都成立。
