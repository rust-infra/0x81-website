# Moyan AI 陪练交付验收记录

Date: 2026-09-27
Branch: `feat/ai-agent`

## 当前可验证结果

| 项目 | 命令 | 结果 |
|------|------|------|
| 后端全量测试 | `cd moyan-backend && cargo test` | 160 passed，0 failed，1 ignored |
| App 纯逻辑测试 | `cd moyan-app && npm test` | 34 passed，0 failed |
| App TypeScript | `cd moyan-app && npx tsc --noEmit` | passed |
| App Web 构建 | `cd moyan-app && npx expo export --platform web` | passed |
| 管理后台测试 | `cd moyan-admin && npx vitest run` | 5 passed |
| 管理后台构建 | `cd moyan-admin && npm run build` | passed |

## 已实现范围

- 底部 Tab：首页 / 陪练 / 播客 / 统计 / 设置；词库迁移到 `/decks` 全屏页。
- 陪练场景：预置 11 个、自定义 CRUD、AI 草稿、模板、本地历史。
- 会话文字版：状态机、重复提交/迟到响应防护、逐轮纠错、沉浸模式、总结保存与回看。
- 头像：SVG 水墨线条 + 内置 Animated；Reduce Motion 逻辑已测试。
- 面试文本链路：简历/职位分别导入、粘贴编辑、敏感项提示与手动删除、档案生成/编辑、面试上下文、复盘字段展示。
- i18n：所有 `coach*` 键中英双语完整。
- 原生上传：图片/文档在 Multipart 中使用 `expo-file-system` 的 `File` Blob，兼容 Expo Fetch 的原生 FormData 转换。
- Web 构建已集成通过。

## 阻塞与未完成

### 原生依赖与 config plugin：已完成

已安装：

- `expo-speech-recognition@57.1.0`
- `expo-image-picker@57.0.20`
- `expo-image-manipulator@57.0.20`
- `expo-document-picker@57.0.2`

已完成：

- 原生 STT 适配器、权限请求、实时字幕、音量环、手动停止与自动提交。
- 相机/相册/PDF/DOCX 选择，长边 1600、JPEG 70、数量/大小校验与本地清理。
- `app.json` config plugin 与中英文权限文案。
- `npx expo prebuild --clean` 成功生成 iOS/Android 工程；Android Manifest 已保留 `RECORD_AUDIO`，iOS Info.plist 已出现麦克风、语音识别、相册和相机权限。
- CocoaPods 安装已在本机 Terminal 完成；`expo run:ios` 构建并启动成功。

### Expo Doctor

`npx expo-doctor` 得到 18/20：

- 仅剩两项网络检查失败：Expo config schema 与 React Native Directory 都需要访问 `exp.host`；当前沙箱无法解析该域名。
- `expo-audio` 的 `expo-asset` peer 已声明为直接依赖，本地检查已恢复。

### iOS 模拟器验收：已执行

设备：`iPhone 15 Pro`，`iOS 26.3`。通过用户本机 Terminal 完成 `pod install` 与 `expo run:ios` 后，在模拟器实测：

- 本地 JWT 登录成功，首页和底部 5 个 Tab 正常。
- 陪练 Tab 成功加载 11 个预置场景、配额 `100/100`、自定义与历史空态。
- 每日站会会话成功启动，头像、开场白和设备 TTS 调用正常。
- 键盘轮次成功提交并生成纠错反馈；发现并修复了推理模型 `reasoning_content` 被误显示为回复的问题。
- 麦克风权限流程成功，STT 实际识别出 “Good morning” 并自动提交，AI 返回自然英文追问。
- 总结页成功生成总评、亮点、待改进和推荐句型；保存后出现在最近练习，点击可回看。
- 面试文本链路实测：粘贴简历、识别手机号/邮箱、手动一键删除、生成结构化档案、进入沉浸式行为面 STAR 会话、生成面试复盘。
- 相册权限弹窗与实际中英文权限文案正确；选择 “Don't Allow” 后 App 正常回退，未崩溃、未上传图片。
- 文件选择器成功拉起 iOS Files。
- 相册权限授予后，从系统相册选择真实图片完成 Vision OCR，识别结果回填为 `HELLO`；在材料确认页编辑为 `HELLO 123` 后输入长度同步更新为 `9 / 20000`，生成档案按钮可用。
- iOS 深色主题切换成功，陪练入口与设置页颜色正常。

尚未覆盖：真实音频输入内容质量、静音开关、蓝牙耳机、切后台、Android `content://` 文件 URI，以及全部 8 套主题逐页截图。

### 页面 UI 还原度复核：已执行

基准：`moyan-app/design/coach/index.html`（390 × 844，共 25 个设计状态）。逐页对照后完成以下统一修正：

- 全局：将 48pt 的超大页头留白收回设计稿的 8pt；卡片阴影改为描边；宣纸白、深夜墨、iOS 浅色的弱文字提升到设计稿的 AA 对比度。
- Tab：改用 58pt 独立悬浮胶囊，放在安全区上方，不再把底部安全区撑进白色 Tab 背景；取消设计稿没有的选中色块。
- 首页：问候、进度卡、今日必修和 2 × 2 数据卡的字号、间距、描边与设计稿对齐。
- 陪练根页：从大卡片列表改为“章节标题 + 紧凑分组行”；面试场景不再混进常规场景；AI 面试官单独保留一个紧凑入口以保证可达性。
- 场景编辑器 / AI 草稿：草稿区改为 accent 底色和红色主按钮，增加生成字段摘要、左右姓名职位、`zh-CN` 口音说明、底部主保存和编辑态删除。
- 会话 / 面试中：增加头像舞台、顶部轮次与今日次数、状态点、回放按钮、底部模式切换、键盘/麦克风/停止三键控制；麦克风保持墨色主按钮，红色只表示正在听。
- 总结 / 面试复盘：增加 hero 统计、总评、亮点、待改进、面试官评估、推荐句型卡片；轮数、纠错、时长与设计稿一致。
- AI 面试官 / 材料：改为紧凑面试官分组、简历与目标职位行、底部来源选择面板；材料确认页增加识别中、扫描件、不支持图片、敏感信息、生成档案状态。
- 档案 / 练习记录 / 陪练设置：档案改为信息提示 + 可编辑卡片；记录页增加全部/陪练/面试筛选和周分组；设置页改为分组列表。

保留的两处有意差异：

- 设计稿的回复卡含一行中文翻译，但当前后端契约没有返回翻译；不伪造文案，先保留英文回复 + 重听。
- 陪练根页增加一个设计稿未画出的“AI 面试官”紧凑入口，否则面试功能无法从 App 内进入。

验证：`npm test` → 30 passed；`npx tsc --noEmit` 和 `npx expo export --platform web` 均通过；并在 iPhone 15 Pro 模拟器逐页复核首页、陪练、会话、总结、AI 面试官、来源面板、材料确认、档案、场景编辑器、陪练设置、练习记录、播客和统计页。

### 语音识别 locale 修复：已执行

复现时 iOS 返回：`Locale en is not supported by the speech recognizer`。根因是会话页把界面语言 `lang`（英文界面时为 `en`）直接传给了 STT；iOS 支持 `en-US`、`en-GB`、`en-IN`、`en-AU` 等识别 locale，但不接受裸 `en`。

修正：

- STT 改为使用场景的 `persona.locale`，不再使用 UI 语言。
- `zh-CN` 口音场景映射到 `en-US` 做英文识别；`zh-CN` 仅保留给 TTS 的中文口音朗读。
- 对未知或不支持 locale 统一回退到 `en-US`，避免原生模块启动失败。
- 新增 locale 映射测试，并在模拟器复现后确认识别状态进入 `Listening`、不再弹出错误。

### AI 聊天体验复核：已修正

- 会话页从“大头像 + 单条回复”改为聊天流：顶部保留紧凑的同事信息条，下面按时间展示所有用户和 AI 消息。
- 用户消息右对齐、AI 消息左对齐；AI 消息带头像首字母、状态和最新回复的重听按钮。纠错面板默认折叠，只显示一条最自然的表达，点击后再展开完整说明，避免挤占聊天区域。
- 增加思考中的气泡和自动滚动到最新消息；用户向上翻阅旧消息时不会被后续布局强制拉回底部。
- 服务端提示词限制为 1–2 个短句、通常少于 40 个词，并且一次最多问一个问题；模型异常输出兜底限制为 240 字符，并在句子边界截断，避免单条回复像长文章。
- 重试逻辑会移除尚未成功发送的临时用户轮次，避免失败后重试出现重复消息。

验证：App `npm test` 33 passed；后端 `cargo test coach` 46 passed；`npx tsc --noEmit`、Web 导出通过。模拟器已检查紧凑同事栏、消息气泡、思考态、语音/键盘控制和退出面板。

### 会话退出与丢弃：已执行

- 只是进入会话、尚未发送任何用户轮次时：返回键、右上角“结束”和 iOS 左滑都会直接离开，不生成总结、不弹结束面板。
- 已经产生至少一个用户轮次后：返回键、结束按钮和系统左滑统一打开结束面板。
- 结束面板现在提供三种结果：结束并查看总结、丢弃本次会话、继续练习。
- “丢弃本次会话”不调用总结接口、不写本地历史，直接回到陪练首页。
- 新增 `hasUserTurn` 纯逻辑测试，覆盖只进入页面与已经聊天两种判断。

### 返回导航统一：已执行

- Tab 根页：首页、陪练、播客、统计、设置不显示返回键。
- 所有二级页面统一使用同一个 `BackButton`：位置、点击热区、图标尺寸和无底色样式一致。
- 覆盖陪练编辑/总结/历史/设置、AI 面试官/材料/档案、词库、词库详情、练习页、播客播放器和搜索结果页。
- 会话页也补上返回键；点击后先弹出结束确认，避免直接退出丢掉本轮历史。
- 会话页使用 `usePreventRemove` 拦截 iOS 边缘左滑和系统返回动作，统一打开同一个结束确认面板；确认后才进入总结。
- 加载态和错误态同样保留返回键，不再出现只能通过系统手势返回的页面。

### 多语言复核：已执行

本轮 UI 修正没有停留在只翻译页面标题，同时补齐了：

- 陪练枚举显示：场景类型、语气、场景、难度、口音提示全部通过 i18n key 渲染。
- AI 模板中英文两套内容；英文模板有独立的标题、描述和练习重点，避免英文界面出现中文模板。
- 主题名称/描述、语言选项、全局设置、登录状态、词库空态、学习模式、确认弹窗和 API fallback 错误。
- 会话轮数、纠错数、历史次数、识别图片数、删除条数等数量词增加单复数 key。
- 历史记录不再把创建时标题当成展示标题；最近练习、练习记录和总结页会按 `scenarioId` 用当前语言重新解析“每日站会”等预置场景标题。
- 新增全量 `zh-CN` / `en` key parity 测试，以及英文模板不得含中文的测试。

模拟器切换英文后复核了首页、陪练根页、场景编辑器、主题列表和设置页；历史标题解析由新增回归测试覆盖，随后已恢复为中文偏好。

### 原生图片上传缺陷修复

首次从 iOS 相册选择真实图片时，Expo Fetch 报错 `Unsupported FormDataPart implementation`。根因是全局 Fetch 会转换 WinterCG FormData，而 `{ uri, name, type }` 的 React Native 文件 part 不再受支持。修复为用 `expo-file-system` 的 `File` 包装本地 URI，让转换器走 `bytes()` Blob 分支，并补充纯逻辑回归测试；随后同一张模拟器相册图片 OCR 成功。

### 真实 LLM 上游验收：已通过

管理员后台配置为 OpenCode Go 兼容接口后，补齐 `x-opencode-session` / `x-opencode-request` / `x-opencode-client` 路由头，并运行：

```bash
cd moyan-backend
cargo test real_llm_contract_smoke -- --ignored --nocapture
```

验证结果：

- `/turn`：返回自然英文回复，实际纠正 `finish → finished` 等 2 处错误
- `/summary`：返回结构化总评、优缺点和表达建议
- `/scenario/draft`：返回 `custom_` 场景，开场白为英文
- `/interview/profile`：返回 157 字的紧凑档案
- `/interview/text`：视觉模型成功读取含 “HELLO 123” 的 PNG，OCR 返回 5 个字符

真实模型的上游契约、JSON 解析与 Vision OCR 已全部闭环。

## 结论

所有代码、原生 config plugin、Web 构建、后端测试、真实 LLM 上游验收和 iOS 模拟器主链路走查均已完成。真实相册图片 OCR 与识别后编辑也已闭环。剩余仅是当前没有 Android/真机音频路由环境可覆盖的物理设备项：静音开关、蓝牙路由、切后台/打断、Android `content://` 文件流，以及 8 套主题逐页截图。
