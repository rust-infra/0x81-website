# Moyan AI 陪练交付验收记录

Date: 2026-09-27
Branch: `feat/ai-agent`

## 当前可验证结果

| 项目 | 命令 | 结果 |
|------|------|------|
| 后端全量测试 | `cd moyan-backend && cargo test` | 160 passed，0 failed，1 ignored |
| App 纯逻辑测试 | `cd moyan-app && npm test` | 30 passed，0 failed |
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
