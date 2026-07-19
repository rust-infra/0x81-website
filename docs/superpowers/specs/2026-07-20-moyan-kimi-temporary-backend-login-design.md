# Moyan Kimi 临时后端登录设计

## 目标

将 Kimi Device Flow 变为后端托管的临时登录流程。后端在成功从 Kimi 授权服务取得 token 后，读取稳定的用户标识创建或更新 Moyan 用户，并签发 Moyan JWT。同步服务继续以该 JWT 中的内部 `user_id` 隔离数据。

## 范围

- 前端不再直接请求 `auth.kimi.com` 的设备授权、token 或 userinfo 端点。
- 后端提供创建授权会话、轮询授权结果的接口。
- Kimi access token 不返回给浏览器、不写入浏览器存储、不作为 Moyan API 的凭证。
- 保持现有 Google 登录和同步 API 不变。

## 流程

1. 客户端 `POST /api/auth/kimi/device`。
2. 后端向 Kimi `device_authorization` 请求设备码，生成随机 `login_id`，在内存中保存设备码、设备 ID、过期时间和轮询间隔；响应只返回 `login_id`、验证 URL、过期时间和建议轮询间隔。
3. 客户端在新窗口打开验证 URL，并对 `POST /api/auth/kimi/token` 传入 `login_id` 进行轮询。
4. 后端基于保存的会话向 Kimi token 端点请求 token。`authorization_pending`/`slow_down` 保持为可轮询响应；过期、拒绝和上游错误终止会话并返回错误。
5. 获取到 access token 后，后端调用 Kimi userinfo 端点。仅当返回非空的稳定 `sub`（或 `id`）时，执行 `find_or_create_user(provider = "kimi")` 并签发 Moyan JWT。
6. 响应 `{ token, user }`，随后删除授权会话。浏览器仅存储该 Moyan JWT。
7. 现有同步接口从 JWT 的 `sub` 取内部用户 ID，因此上传和下载自动落入对应用户的数据分区。

## 数据与接口

授权会话仅为短期进程内数据，不写数据库：

```text
login_id -> { device_code, device_id, expires_at, poll_interval }
```

`POST /api/auth/kimi/device` 返回：

```json
{
  "data": {
    "login_id": "opaque-random-id",
    "verification_uri_complete": "https://...",
    "expires_in": 600,
    "interval": 5
  }
}
```

`POST /api/auth/kimi/token` 接收：

```json
{ "login_id": "opaque-random-id" }
```

授权尚未完成时返回可识别的 pending 状态；成功时返回现有 `AuthResponse`。

## 安全与限制

- 删除现有“客户端上传 Kimi access token 后无验签解码”的登录入口，避免伪造 token 换取 Moyan JWT。
- 仅由后端直接从 Kimi token 端点取得的 token 才会用于 userinfo 请求。
- 如果 Kimi userinfo 不可用、没有稳定用户 ID 或返回异常，登录失败，绝不以 token 哈希、随机值或未验证 JWT payload 建立账户。
- 授权会话在服务重启后失效；这是临时方案可接受的限制，用户可重新登录。
- 需要配置 Kimi 上游可访问性；当前使用项目已有的客户端标识和端点，未来应替换为 Kimi 正式分配的第三方 OAuth 客户端。

## 测试

- 授权会话创建后，返回值不包含 `device_code` 或 access token。
- pending 与 `slow_down` 不创建用户、不签发 JWT。
- 成功 token + 有效 userinfo 稳定 ID 时，创建/更新 Kimi 用户并返回 Moyan JWT。
- userinfo 缺少稳定 ID 时拒绝登录。
- 伪造的 `login_id`、过期会话和重复消费会被拒绝。
