# Android 发布（EAS Build + GitHub Actions）

两个 App（`moyan-app`、`rehearse-app`）都是 Expo managed 工程，没有提交 `android/` / `ios/`
原生目录。Android 包由 **EAS Build** 在云端构建，GitHub Actions 只负责触发、下载产物并
保存为 workflow artifact。

## 产物

工作流 `.github/workflows/android-release.yml` 一次构建四个包：

| Artifact | 内容 |
|---|---|
| `moyan-app-aab` | 墨言的 AAB（`production` profile，用于 Google Play） |
| `moyan-app-apk` | 墨言的 APK（`preview` profile，用于侧载/内测） |
| `rehearse-app-aab` | 职演的 AAB（用于 Google Play） |
| `rehearse-app-apk` | 职演的 APK（用于侧载/内测） |

包名：

- 墨言：`uk.x81.moyan`
- 职演：`uk.x81.rehearse`

⚠️ Google Play 首次上传后包名不能改。墨言原来 `com.anonymous.moyanapp` 是占位；另外
Android applicationId 的每一段必须以字母开头，`uk.0x81.*` 里的 `0x81` 非法，所以统一用
`uk.x81.*`。iOS bundleIdentifier 同步改了。

## 一次性准备

### 1. Expo 账号与 EAS 项目

```bash
npx eas-cli@latest login
cd moyan-app && npx eas-cli@latest init
cd ../rehearse-app && npx eas-cli@latest init
```

`eas init` 会在各自的 `app.json` / `app.config.js` 里写入 `extra.eas.projectId`，并创建
EAS 项目。**把这两个改动提交**，CI 才能在正确的项目下构建。没有 projectId 时 workflow 的
`eas project:info` 会失败。

### 2. Android 签名

每个 App 执行一次：

```bash
cd moyan-app && npx eas-cli@latest credentials -p android
cd ../rehearse-app && npx eas-cli@latest credentials -p android
```

选择让 EAS 生成并托管 keystore。CI 是 `--non-interactive`，没有凭据会直接失败，所以这一步
必须在本地完成。Google Play 使用 Play App Signing 时，这个 keystore 是上传密钥。

### 3. GitHub Secret

在 GitHub 仓库 Settings → Secrets and variables → Actions 添加：

- `EXPO_TOKEN`：Expo 账号设置 → Access tokens 创建
- `GOOGLE_SERVICE_ACCOUNT_JSON`：只有要自动提交 Google Play 时才需要，内容见下面「自动提交到 Google Play」

### 4. Google Play Console（手动，一次性）

- 创建两个应用，包名必须是上面的 `uk.x81.moyan` / `uk.x81.rehearse`
- 启用 Play App Signing
- 完成 Data safety（麦克风、相机）、内容分级、隐私政策
- **先手动上传一次 AAB**（可以用 workflow artifact），之后 API 才能自动提交

## 触发构建

- GitHub Actions → **Android Release** → Run workflow（可勾选 submit）
- 或推送 tag：
  - `android-v*`：只构建，不提交
  - `android-release-v*`：构建 + 提交 Google Play

```bash
git tag android-v0.1.0 && git push origin android-v0.1.0
```

构建在 EAS 云端跑，GitHub job 会等它完成，然后把 AAB/APK 下载到 workflow artifact。
EAS 构建页同时保留一份可下载产物。

## 自动提交到 Google Play

工作流支持在 AAB 构建后执行 `eas submit`：

- 手动 Run workflow 时勾选 **submit**
- 或推 `android-release-v*` tag（构建 + 提交；普通 `android-v*` 只构建，不提交）

准备：

1. Google Cloud 创建 service account，启用 **Google Play Android Developer API**，下载 JSON key
2. Play Console → Users and permissions → 邀请 service account 邮箱，授予 **Release manager**（或 Admin），只给这两个应用
3. GitHub secret `GOOGLE_SERVICE_ACCOUNT_JSON` = JSON 全文
4. `eas.json` 的 `submit.production.android` 已指向 `./google-service-account.json`，默认 `track: internal`；要直接上生产就改成 `production`

注意：Google Play 通常要求应用先在 Console 创建并手动上传过一次 AAB，API 才能提交；第一次先用 artifact 手动上传。

## 版本号

`eas.json` 用 `appVersionSource: "remote"` + `autoIncrement: true`，EAS 自动递增 Android
`versionCode`。面向商店的 `versionName` 是各自 `app.json` 里的 `expo.version`；发版前手动改：

```json
"version": "1.0.1"
```

## 常见失败

| 现象 | 原因 |
|---|---|
| `eas project:info` 报 no project | 没跑 `eas init`，或 `extra.eas.projectId` 没提交 |
| `--non-interactive` 报 credentials | 没跑 `eas credentials -p android` |
| `EXPO_TOKEN is not set` | 没配 GitHub secret |
| `GOOGLE_SERVICE_ACCOUNT_JSON is not set` | 要自动提交时没配 secret |
| `eas submit` 报 service account | secret 内容不对，或 service account 没在 Play Console 授权 |
| `eas submit` 报 app not found | Play Console 还没创建应用，或还没首次手动上传 |
| AAB 下载为空 | EAS build 失败；看 workflow 里 `build.json` 或 EAS 构建页 |
| Google Play 拒绝包名 | 包名和 Play Console 里创建的不一致，或首次上传后试图修改 |
