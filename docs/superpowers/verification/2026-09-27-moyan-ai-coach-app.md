# Moyan AI 陪练交付验收记录

Date: 2026-09-27
Branch: `feat/ai-agent`

## 当前可验证结果

| 项目 | 命令 | 结果 |
|------|------|------|
| 后端全量测试 | `cd moyan-backend && cargo test` | 160 passed，0 failed，1 ignored |
| App 纯逻辑测试 | `cd moyan-app && npm test` | 29 passed，0 failed |
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
- CocoaPods 安装仅因当前环境无法解析 `cdn.cocoapods.org` 失败，不是工程配置错误。

### Expo Doctor

`npx expo-doctor` 得到 18/20：

- 仅剩两项网络检查失败：Expo config schema 与 React Native Directory 都需要访问 `exp.host`；当前沙箱无法解析该域名。
- `expo-audio` 的 `expo-asset` peer 已声明为直接依赖，本地检查已恢复。

### 真机验收尚未执行

没有可用 iOS / Android 真机或模拟器会话，因此以下项未验证：

- 麦克风/语音权限允许与拒绝
- 静音开关下 TTS
- 蓝牙耳机
- 打断 TTS 后立即 STT
- 切后台恢复
- Android content:// 文件 URI
- 8 套主题与 Reduce Motion 截图对比

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

所有代码、原生 config plugin、Web 构建、后端测试与真实 LLM 上游验收均已完成。剩余项只有原生包安装/真机走查：当前环境无法访问 CocoaPods/Gradle/Expo 外部网络，也没有可用的 iOS/Android 设备会话。
