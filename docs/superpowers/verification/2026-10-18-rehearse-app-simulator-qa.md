# Rehearse App 模拟器自测报告（2026-10-18）

> 对象：`rehearse-app`，iPhone 17 Pro / iOS 26.3 模拟器，dev client（Metro :8083）。
> 后端：`rehearse-backend` :4324（容器内，SQLite）、`moyan-backend` :4323（容器内）。
> 结论：**11 个路由全部能渲染、无崩溃**；后端契约全部通过；但存在 **1 个阻断级 UX 缺陷** 与
> **3 个明显缺陷**（其中 2 个是墨言残留）。

## 1. 测试方法（以及为什么这么绕）

模拟器没有可用的点击通道：`xcrun simctl` 不支持 tap，`idb` / `idb-companion` 安装失败，
`osascript` 操作 Simulator 窗口被系统拒绝（`-10004 privilege violation`，无辅助功能权限）。
另外 iOS 对自定义 scheme 的 `simctl openurl` **一律弹「Open in "Rehearse"?」确认框**，
而确认框点不掉。

最终采用的办法：

1. **免登录注入**：把 `rehearse_token` / `rehearse_user` 直接写进
   `Library/Application Support/uk.0x81.rehearse/RCTAsyncLocalStorage_V1/manifest.json`。
2. **逐屏驱动**：临时把 `src/app/index.tsx` 的 `<Redirect>` 指向目标路由，冷启 App
   （走 `exp+rehearse-app://expo-development-client/?url=…`，这个 scheme 不弹框），
   Metro 处于 watch 模式所以改完即生效，然后 `simctl io screenshot`。
3. 跑完已把 `index.tsx` **还原**成正式的登录态分流版本。

⚠️ 由此带来两个测试盲区：**无法验证点击/输入类交互**，也**无法验证手势与滚动**。
另外 dev client 右上角常驻一个「Tools」齿轮，会**遮住页面头部的右侧按钮**
（保存 / 重新识别 / 重新生成）——这是开发态浮层，不是产品缺陷，但影响了那几处的视觉核对。

## 2. 覆盖矩阵

| # | 路由 | 截图 | 渲染 | 观察 |
|---|---|---|---|---|
| 1 | `/(tabs)/rehearse` | `t01-rehearse.png` | ✅ | **整页被「AI 陪练暂不可用」替换**，见 P0-1 |
| 2 | `/history` | `s02-history.png` | ✅ | 空态正常；筛选词「陪练」是墨言语义 |
| 3 | `/settings` | `s03-settings.png` | ⚠️ | 4 套主题；底部内容被 Tab 栏遮住 |
| 4 | `/rehearse/editor` | `s04-editor.png` | ✅ | 一句话生成 + 模板 + 表单，最像设计稿的一屏 |
| 5 | `/rehearse/session` | `s05-session.png` | ⚠️ | 缺参 → 「陪练加载失败」，属预期；文案仍是「陪练」 |
| 6 | `/rehearse/summary` | `s06-summary.png` | ⚠️ | 缺参 → 「总结生成失败」，属预期 |
| 7 | `/rehearse/settings` | `s07-rsession-settings.png` | ✅ | 逐轮纠错/沉浸、口音、自动播放、材料管理，与设计一致 |
| 8 | `/rehearse/material` | `s08-material.png` | ✅ | 「AI 面试官」：3 位面试官 + 简历/职位材料 |
| 9 | `/rehearse/material/materials` | `s09-materials.png` | ✅ | 「确认材料」：OCR 结果编辑、敏感信息提示 |
| 10 | `/rehearse/material/profile` | `s10-profile.png` | ⚠️ | 内容为空却显示「已从你的简历生成档案」，见 P1-3 |
| 11 | `/speech-settings` | `s11-speech.png` | ⚠️ | 「语音与密钥」只有两行只读文案，没有任何可编辑控件 |
| 12 | `/login` | `rehearse-sim6.png` | ✅ | 已修品牌（职演）；仍是 Kimi/Google/token 三选一 |

## 3. 缺陷清单

### P0-1 · LLM 未配置时整个演练页不可用（阻断）

`src/app/(tabs)/rehearse.tsx:135-140` 把「能不能开始一次演练」的检查当成了**页面级开关**：

```ts
const startReason = quota ? canStartCoach({ quota, scenario: presets[0] }) : null;
const unavailableKind = loadError ? 'network'
  : quota && startReason && !startReason.ok ? startReason.reason : null;
```

而 `src/lib/rehearse-selection.ts:37` 里：

```ts
if (!quota.llm_configured) return { ok: false, reason: 'llm' };
```

后果：只要管理端没配 LLM key，用户**连 14 个预置场景和「AI 面试官」入口都看不到**，
只看到一屏「AI 陪练暂不可用，请联系管理员配置模型」。而这恰恰是新装环境的默认状态
（本机 `llm_configured: false`）。

预期行为：场景列表照常展示，只在**点击开始**时提示「AI 暂不可用」，或把开始按钮置灰。
后端 `/api/rehearse/scenarios` 本身是 200 且有数据（已验），页面完全可以渲染。

### P1-1 · 墨言文案残留（多处）

| 位置 | 现状 | 应为 |
|---|---|---|
| `translations.ts:94` | `只有陪练不可用，词库、播客和练习记录不受影响。` | 职演没有词库/播客；应只说明演练不可用 |
| `translations.ts:529`（en） | `Decks, podcasts and history still work.` | 同上 |
| 演练页标题 | `AI 陪练` | `职演` / `演练` |
| 历史页筛选 | `全部 / 陪练 / 面试` | 「陪练」不在职演词汇里 |
| 设置页分组 | `陪练设置` | `演练设置` |

`appName` / `appDesc` 已在本次修复（`职演` / `在你真正开口之前，先演一遍`）。

### P1-2 · 历史 / 设置两个 Tab 的底部内容被浮动 Tab 栏盖住

自定义 Tab 栏是 `position: absolute` 的浮层，高度约 `58 + insets.bottom + 14`。
三个 Tab 的 `ScrollView` 底部留白不一致：

| 文件 | `paddingBottom` | 结果 |
|---|---|---|
| `(tabs)/rehearse.tsx:310` | `150` | ✅ 正确 |
| `(tabs)/history.tsx:196` | `40` | ❌ 最后一行被遮 |
| `(tabs)/settings.tsx:619` | `48` | ❌ 「陪练设置」被遮（截图可见） |

### P1-3 · 「面试档案」无条件显示「已从你的简历生成档案」

`src/app/rehearse/material/profile.tsx:88-92` 的提示条没有条件判断。直接进入该页
（`profile` 参数为空）时，正文是空的、`0 / 3000`，却仍然告诉用户「已从你的简历生成档案」。
`开始面试` 按钮此时是禁用的，两者自相矛盾。应在 `profile.trim()` 为空时换成空态/引导。

### P2-1 · 主题有 4 套，设计稿只有 2 套

`src/lib/theme.ts:43-138` 暴露 `xuanzhi / shenyemo / dailan / fense`（宣纸白 / 深夜黑 / 黛蓝 / 藕粉）。
设计稿 §验收里写的是「浅色 / 深色两套」（`2026-10-02-rehearse-design.md:1221`）。
设置页因此有 4 个色块。

### P2-2 · App 图标仍是墨言的

`assets/icon.png` 与 `moyan-app/assets/icon.png` **md5 完全相同**
（`e6159233ed59c4ad00e494f1115e3918`）。桌面图标仍是那枚「墨」印章。

### P2-3 · 登录页未按设计稿

仍是墨言那套「Kimi / Google / 粘贴 token」的三段式布局。设计稿第 1 屏不是这个结构
（职演的入口应更短，且 dev 用的 token 登录不该和正式登录平级）。

### ~~P3 · 「语音与密钥」页过于空~~ —— **误判，已更正**

> 首轮结论：`/speech-settings` 只有两行只读文案，切到 Google / Gemini /
> ElevenLabs / 阿里 后没有密钥输入控件。
>
> **实际不是这样。** 那一屏是**按当前 provider 分支渲染**的：默认
> `sttProvider=system` / `provider=webspeech` 时才只显示「不需要密钥」。
> 把 `speech_settings` 里的 provider 改成 `gemini` + `elevenlabs` 后重进，
> 会正常出现「Gemini API Key + 模型」「TTS API Key」以及「未配置则无法使用」
> 的提示（见 `v2-speech.png`）。
>
> 教训：**默认状态下的一屏不能代表所有分支**。这类「看起来缺控件」的判断，
> 必须先把状态切到目标分支再下结论。

## 4. 后端契约验证（全部通过）

| 用例 | 结果 |
|---|---|
| `GET /health` | 200 `{"database":"ok","dialect":"sqlite","database_defaulted":false}` |
| `GET /api/rehearse/whoami`（有效 JWT） | 200，claims 正确回显 |
| `GET /api/rehearse/quota` | 200，`limit 100 / used 0 / remaining 100` |
| `GET /api/rehearse/scenarios?language=zh-CN` | 200，**14** 个场景 |
| `GET /api/rehearse/scenarios?language=en-US` | 200，**14** 个场景（id 集合一致） |
| `POST /api/rehearse/turn`（`mode=feedback`） | **503** `AI service is not configured`（预期） |
| `POST /api/rehearse/summary` | **503** 同上（预期） |
| 无 token 访问 `/api/rehearse/*` | **401** `Missing authorization token` |
| `PUT/GET /api/admin/settings/rehearse` | 200，`api_key_set: false` |

客户端确实带了 `?language=`（`rehearse-api.ts:29`），所以预置场景里 2 个 `zh-CN`
不会造成 400 —— 设计稿里记的那个坑在客户端侧已规避。

## 5. 未覆盖

- **真实一轮演练**：`/turn` 与 `/summary` 都依赖 LLM，本机没有 key，只能验到 503。
- **录音 / STT**：需要麦克风权限与真机/模拟器音频输入，且无法点击「开始录音」。
- **Kimi / Google 登录**：需要真实账号，且要点击。
- **材料 OCR 上传**：依赖 LLM，未验。
- **滚动 / 手势 / 键盘避让**：无点击通道，未验。
- **深色主题**：未逐屏切换核对（只能看到默认的浅色）。

## 6. 修复记录（2026-10-18，同日）

已修 P0 + 全部 P1，`npm test` 75/75 通过，模拟器复验通过。

| 编号 | 修法 | 文件 |
|---|---|---|
| P0-1 | `canStartCoach` 不再当页面级开关：页面级只保留 `loadError → network`；`llm` / `quota` 降级为顶部横幅 + 点击时的 toast（原来 `start()` 静默 return，点了没反应） | `(tabs)/rehearse.tsx` |
| P1-1 | 10 个中文键 + 10 个英文键改写：`coachPageTitle` → 职演 / Rehearse、`coachHistoryPageTitle` → 历史 / History、`coachFilterCoach` → 演练、`coachSettingsTitle` → 演练设置、`coachUnavailableLLM(Desc)` 重写、`coachLoadFailed` / `coachComingSoon` / `coachPermissionMicDesc` / `coachNoHistory` / `coachStartHint` 同步。`translations.ts` 里 `陪练` 归零 | `lib/translations.ts` |
| P1-2 | `paddingBottom` 40 / 48 → **150**，与 `rehearse.tsx` 对齐 | `(tabs)/history.tsx`、`(tabs)/settings.tsx` |
| P1-3 | 「已从你的简历生成档案」改为 `profile.trim()` 为真时才渲染 | `rehearse/material/profile.tsx` |

⚠️ P1-2 只能靠**算术与一致性**确认：截图停在滚动顶部时，浮动 Tab 栏本来就会盖住中间内容；
真正的判据是「滚到底时最后一行能否露出来」，而当前没有滚动手势通道，未做视觉复验。

仍未处理（P2/P3，属设计决策，未擅自改）：

- 4 套主题 vs 设计稿的 2 套（`theme.ts`）。
- `assets/icon.png` 仍是墨言那枚「墨」印章（与 moyan-app md5 相同）。
- 登录页仍是 Kimi / Google / token 三段式，未按设计稿第 1 屏重做。
- `/speech-settings` 在非系统 provider 下没有任何密钥输入控件，需确认是漏了还是有意。

## 7. 第二轮修复（P2 + P3 复核，2026-10-18）

| 项 | 改法 | 文件 |
|---|---|---|
| 主题 4 → 2 | `ThemeName` 收敛成 `'light' \| 'dark'`；色值**整体换成设计稿的职演配色**（强调色 210° 蓝 `#2F5D8C` / `#6FA3D9`），不再用墨言的米白 + 墨红。新增 `migrateThemeName()` 把旧的 4 个名字按明暗迁移（`xuanzhi/dailan/fense → light`、`shenyemo → dark`），避免升级后主题跳回默认 | `lib/theme.ts`、`lib/theme-context.tsx`、`(tabs)/settings.tsx` |
| 主题测试 | 原来的「four supported themes」改成断言只有 light/dark + 两套 token 键集一致 + 旧名迁移 | `lib/theme.test.ts` |
| 主题文案 | 删掉 `themeXuanzhi*` 等 8 个键，换成 `themeLight/themeDark(+Desc)` 中英各 4 个 | `lib/translations.ts` |
| App 图标 | 用设计稿登录页那枚**麦克风**标记 + `#2F5D8C` 生成 1024 图标，并同步 favicon 与 Android 的 foreground/background/monochrome（`rsvg-convert` 从 SVG 出图）。iOS 图标 `hasAlpha: no`，符合要求 | `assets/*.png` |
| 登录页 | 按设计稿第 1 屏重做：居中麦克风标记（72×72 / 圆角 22 / `accentLight` 底）+ 职演 + 一句话 + 「面试 · 晋升答辩 · 汇报 · 高压沟通」；底部 Google（主，带单色 G）+ Kimi（次）+「已有墨言账号？直接登，不用重新注册。」 | `app/login.tsx` |
| P3 复核 | **误判已更正**：`/speech-settings` 本来就是按 provider 分支渲染的，把 provider 切成 `gemini` + `elevenlabs` 后密钥输入与「未配置则无法使用」提示都在 | — |

**与设计稿的一处有意差异**：登录页底部保留了一个 11px 的「开发：粘贴 token」弱化链接。
本地没有 Google / Kimi 账号时这是唯一入口（`rehearse-backend` 只验签、不签发），
但它不参与正式登录的按钮层级。

**复验**：`npm test` **77/77**；模拟器上逐屏确认——登录页（新结构）、设置页（2 个色块）、
深色主题（整屏换色后对比度正常）、语音与密钥（gemini + elevenlabs 分支）。
