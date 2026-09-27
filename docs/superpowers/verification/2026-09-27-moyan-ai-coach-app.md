# Moyan AI 陪练交付验收记录

Date: 2026-09-27
Branch: `feat/ai-agent`

## 当前可验证结果

| 项目 | 命令 | 结果 |
|------|------|------|
| 后端全量测试 | `cd moyan-backend && cargo test` | 159 passed，0 failed，1 ignored（真实上游 smoke） |
| App 纯逻辑测试 | `cd moyan-app && npm test` | 26 passed，0 failed |
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

### 原生依赖安装被审批服务阻塞

`npx expo install expo-speech-recognition expo-image-picker expo-image-manipulator expo-document-picker` 多次被外部审批 reviewer 以 HTTP 502 拒绝，命令没有执行。因此：

- STT 真机语音识别、麦克风权限流程、音量环尚未接线。
- 相机/相册/PDF/DOCX 选择和图片压缩尚未接线。
- `app.json` 中的 speech-recognition / image-picker / document-picker 插件尚未添加。
- Task 7、Task 8 的语音部分、Task 10 的图片/文件部分尚未完成。

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

### 真实 LLM 上游验收仍阻塞

`cargo test real_llm_contract_smoke -- --ignored --nocapture` 已运行，但本机 `OPENAI_API_KEY` 与 `DEEPSEEK_API_KEY` 都返回 HTTP 401 invalid。真实模型的 `response_format` 接受情况和 schema 质量仍未被外部上游证明。

## 结论

所有不需要新增原生依赖、真实 LLM 凭据或真机的工作已完成并通过当前测试/构建。剩余项需要先恢复依赖安装审批，并提供有效模型 Key 与真机环境。
