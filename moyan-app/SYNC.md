# SYNC.md — 与 `rehearse-app` 的同步契约

`rehearse-app` 是从本 App **复制**出来的（不是共享包，理由见设计稿 §8.4：两个 App 要独立发版，抽 workspaces 会把升级节奏绑死）。

复制换来了独立性，代价是**同一个 bug 要修两遍**。这份文件就是为了让「该同步的」不会漂走。

规则：改下面「必须同步」里的任何文件时，**同一批**改 `rehearse-app` 的同名文件，并在提交信息里写明「已同步到 rehearse-app」。改「允许漂移」里的文件不用管对面。

---

## 必须同步

这几处一旦分叉，表现是**安全问题或行为不一致**，而不是编译错误——所以只能靠纪律。

| 文件 | 为什么必须同步 |
|---|---|
| `src/lib/api.ts` | 鉴权与错误信封。分叉 = 两个 App 对 401 / 429 / 503 的处理不同，安全策略不一致 |
| `src/lib/api-client.ts` | 请求层（超时、重试、`AbortSignal`）。分叉 = 同一个后端在两个 App 眼里行为不同 |
| `src/lib/api-error.ts` | 错误码判别（`reason` 只在 429/422 出现、`code` 是**数字**）。契约见设计稿 §7.6 |
| `src/lib/auth.tsx` | 登录态与 token 存取。分叉 = 同一台设备上两个 App 的登录语义不同 |

**「同步」不等于「逐字节相同」**——两边的域名/端口/存储键本来就不同（见下）。要求的是**逻辑**一致：同样的状态码走同样的分支，同样的字段名对应同样的含义。

## 允许漂移

| 文件 | 差异 |
|---|---|
| `src/lib/speech.ts` | Rehearse 只留它用得到的 TTS 供应商 |
| `src/lib/theme.ts` | Rehearse 裁剪主题集 |
| `src/lib/translations.ts` | 场景词汇完全不同 |
| `src/lib/ui.ts` | `screen.*` / `cardStyle()` 的视觉基线 |
| `src/lib/voices.ts` | 音色列表 |

## 本来就不同（不要「修」成一样）

| 项 | moyan-app | rehearse-app |
|---|---|---|
| 业务后端端口 | `4323` | `4324` |
| 认证后端端口 | `4323` | `4323`——职演没有自己的认证服务，登录仍由 `moyan-backend` 提供 |
| 存储键 | `moyan_token` / `moyan_user` | `rehearse_token` / `rehearse_user` |
| URL scheme | `moyan://` | `rehearse://` |
| bundle id | `com.anonymous.moyanapp`（占位符，未上架） | `uk.0x81.rehearse` |
| Tab | 首页 / 词库 / 播客 / 统计 / 设置 | 演练 / 历史 / 设置 |

⚠️ `getAuthBase()` 的**回落**是两边最容易写错的一处：墨言回落到 `getApiBase()` 是对的（登录与业务同一个后端），职演**不能**这么写——业务在 4324、认证在 4323。见 `rehearse-app/src/lib/config.ts` 的注释。

## 与 coach 拆分的交叉点

`moyan-app` 侧的 coach 功能**还在**，要到阶段 4 的原子切换时才删（设计稿 §11：删早了墨言 App 立刻 404）。

- 现在：两边都有 coach 代码，但只有墨言的那份在线上跑
- 切换时：删 `moyan-app/src/app/coach/*`、`src/components/coach/*`、`src/lib/coach-*`，以及 4 个依赖（`expo-speech-recognition` / `expo-image-picker` / `expo-image-manipulator` / `expo-document-picker`）和 4 项权限（相机 / 相册 / 麦克风 / 语音识别）
- ⚠️ 删完之后 `moyan-app` 与本文件里「允许漂移」那几项的差异会变大（`speech.ts` / `theme.ts` / `translations.ts` 里的 coach 部分会消失）——那是**预期**的，不是漂移

## PR 检查项

提 PR 时如果动了「必须同步」里的文件，勾一下：

- [ ] 同一批改了 `rehearse-app` 的同名文件
- [ ] 提交信息里写了「已同步到 rehearse-app」
- [ ] 如果**故意**不同步，在提交信息里写清为什么
