# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

---

# rehearse-app

职演（Rehearse）的 App。**从 `moyan-app` 复制而来**，不是共享包——两个 App 独立发版。
该同步什么、可以漂移什么，见 `SYNC.md`（动 `lib/api*.ts` / `lib/auth.tsx` 之前先读它）。

设计稿：`design/index.html`（18 屏，3 套主题，深链 `?only=N`）。
产品与接口的设计文档在仓库根的 `docs/superpowers/specs/2026-10-02-rehearse-design.md`。

## 跑测试

```sh
npm ci        # ⚠️ 必须用 ci，不要用 install（见下）
npm test      # tsc -p tsconfig.test.json && node --test .test-dist/lib/*.test.js
```

**17 个测试文件 / 75 个测试**，纯 TypeScript + Node 内置 test runner，不需要 metro / jest，
也不需要模拟器——`lib/` 那一层是纯逻辑，改完立刻能验。

⚠️ **`npm install` 会失败**：`react-dom@19.3.0` 要求 peer `react@^19.3.0`，而本项目钉的是
`react@19.2.3`，直接 ERESOLVE。`package-lock.json` 里有已解析好的组合，所以用 `npm ci`
（它按 lock 装，不做 peer 解析）。

## 几个容易踩的地方

- **业务与认证是两个后端**：业务 `rehearse.0x81.uk`（容器 4324），认证 `auth.0x81.uk`
  （由 `moyan-backend` 提供，4323）。`lib/config.ts` 里 `getApiBase()` 与 `getAuthBase()`
  的**回落必须分开写**——照抄墨言那种「登录回落到业务地址」的写法，开发环境登录会打到
  4324 拿 404，而症状只是「登录没反应」。
- **线上契约的权威是 `rehearse-backend/internal/model/coach.go`**，不是本目录的类型。
  字段名对不上时以那份 Go DTO 的 struct tag 为准（设计稿 §7.6 记了每个改名的理由）。
- **中文演练还没做**（阶段 7）。`language: 'zh-CN'` 现在会拿到 400，预置场景里有 2 个默认
  语言是 `zh-CN`——客户端开始会话时要覆盖成 `en-*`。
