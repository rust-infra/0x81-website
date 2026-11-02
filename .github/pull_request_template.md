## 改了什么

<!-- 一句话说清「换来了什么、代价是什么」。别只贴 diff 摘要。 -->

## 门禁

- [ ] `rehearse-backend/` 改了 → `cd rehearse-backend && make check`
- [ ] `rehearse-app/` 改了 → `cd rehearse-app && npm test`（17 个文件 / 75 个测试）
- [ ] `website-rs/` 改了 → `scripts/check-rust.sh`
- [ ] 设计稿跟着改了（换库 / 改路由 / 改契约时**必须**改 `docs/superpowers/specs/`）

## 跨 App 同步（设计稿 §8.4）

`rehearse-app` 是从 `moyan-app` 复制出来的，不是共享包。「必须同步」的那几个文件
（`lib/api.ts` / `lib/api-client.ts` / `lib/api-error.ts` / `lib/auth.tsx`）一旦分叉，
表现是**安全问题或行为不一致**，不会编译失败。清单见两个 App 各自的 `SYNC.md`。

- [ ] 本次**没有**动「必须同步」里的文件
- [ ] 或者：动了，且**同一批**改了另一个 App 的同名文件
- [ ] 或者：故意不同步，理由写在提交信息里

## 契约

- [ ] 如果改了 HTTP 字段/路径：`rehearse-backend/internal/model/*.go` 与
      `rehearse-app/src/lib/rehearse-types.ts` **两边都改了**（设计稿 §7.6 是改名的权威清单）
