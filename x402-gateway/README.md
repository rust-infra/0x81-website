# x402-gateway（Phase 0）

独立运行的最小 x402 支付网关，Rust + Axum + SQLx。先验证支付闭环，不接 CrabBridge、website-rs、0x81 登录或 SSE。

一个没有付款的请求会拿到 HTTP 402 和付款要求。带上有效付款的请求会拿到 200，并在账本里留下且只留下一条 `served` 记录。同一个 nonce 重放会返回 409。

## 快速开始

```bash
make demo
```

`make demo` 会编译二进制，启动 mock facilitator 和网关，跑一次 402、一次 200、查询账本，再重放一次确认 409。它使用临时 SQLite 文件，不碰仓库里的 `data/`。

## 手动运行

```bash
mkdir -p data
export X402_FACILITATOR_URL=http://127.0.0.1:4402
export X402_PAY_TO=0x1111111111111111111111111111111111111111
export X402_ADMIN_TOKEN=dev-admin-token
export X402_DATABASE_URL=sqlite:./data/ledger.db

cargo run --bin mock_facilitator &
cargo run --bin migrate
cargo run --bin x402-gateway
```

未付款请求：

```bash
curl -i -X POST http://127.0.0.1:4330/v1/echo \
  -H 'Content-Type: application/json' \
  -d '{"message":"hello"}'
```

返回 402，响应头 `PAYMENT-REQUIRED` 是 base64 的付款要求，响应体里也有 `accepts` 数组。

付款请求需要在 `PAYMENT-SIGNATURE` 里放 base64 的付款 payload。Phase 0 的 mock facilitator 不验签，只检查字段；`make demo` 会生成一个可用的 payload。

## 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | DB 可写、schema 版本正确、facilitator `/supported` 可达时返回 200，否则 503 |
| GET | `/v1/models` | 免费返回当前价格表 |
| POST | `/v1/echo` | 付费测试端点，返回请求里的 JSON |
| GET | `/admin/payments/{request_id}` | 只读账本查询，需要 `X-Admin-Token` |

## 支付顺序

1. 解析请求体和价格。
2. 没有付款头，返回 402。
3. 解析并检查付款授权：收款地址、金额、有效期、nonce。
4. 先查 nonce 是否已用过，重放直接 409，不调用 facilitator。
5. 调用 facilitator `/verify`。
6. 插入 `payment_attempts`，唯一 nonce 和每付款人单笔在途由数据库约束保证。
7. 调用 facilitator `/settle`，成功后才服务。
8. 返回 200 和 `PAYMENT-RESPONSE`，账本标记 `served`。

先结算再服务，是因为后面接流式响应时 HTTP 头在开流前就固定，结算回执只能在那之前拿到。服务启动时会清理上次进程留下的 `verified`、`settling` 和 `settled` 行，避免付款人被永久锁住。

## 配置

| 变量 | 必填 | 默认 |
|---|---|---|
| `X402_PORT` | 否 | `4330` |
| `X402_DATABASE_URL` | 否 | `sqlite:./data/ledger.db` |
| `X402_FACILITATOR_URL` | 是 | 无 |
| `X402_PAY_TO` | 是 | 无 |
| `X402_NETWORK` | 否 | `eip155:84532` |
| `X402_ASSET` | 否 | Base Sepolia USDC |
| `X402_ASSET_SYMBOL` | 否 | `USDC` |
| `X402_ASSET_DECIMALS` | 否 | `6` |
| `X402_ASSET_NAME` | 否 | `USDC` |
| `X402_ASSET_VERSION` | 否 | `2` |
| `X402_ASSET_TRANSFER_METHOD` | 否 | `eip3009`；USDT 用 `permit2` |
| `X402_PRICE_ATOMIC` | 否 | 不设时用迁移里的 `echo` 价格 1000 |
| `X402_PUBLIC_BASE_URL` | 否 | `http://127.0.0.1:4330` |
| `X402_ADMIN_TOKEN` | 是 | 无，至少 8 个可见 ASCII 字符 |
| `X402_FACILITATOR_TIMEOUT_SECONDS` | 否 | `10` |
| `X402_LOG_LEVEL` | 否 | `info` |

价格和账本金额都是资产的原子单位。USDC 和 USDT 在 EVM 上通常都是 6 位小数，所以 1000 表示 0.001。

SQLite 由 SQLx 打开，设置 WAL、`synchronous(FULL)`、`busy_timeout(5000)` 和 `foreign_keys(on)`。主网账本需要 Postgres，Phase 0 不实现。

## USDT 与 Permit2

USDT 不支持 EIP-3009。x402 的 `exact` 方案对这类 ERC-20 使用 Permit2。网关已经支持 Permit2 payload，配置示例：

```bash
export X402_NETWORK=eip155:1
export X402_ASSET=0xdAC17F958D2ee523a2206206994597C13D831ec7
export X402_ASSET_SYMBOL=USDT
export X402_ASSET_DECIMALS=6
export X402_ASSET_TRANSFER_METHOD=permit2
```

此时付款 payload 的 `payload` 里是 `permit2Authorization`，不是 `authorization`。服务端会校验 `permitted.token`、`permitted.amount`、`witness.to` 和 `deadline`，facilitator 仍然负责验签和上链。

所选 facilitator 必须支持该网络和资产。公共 `x402.org` facilitator 的 `exact` 只列出 `eip155:84532`，默认资产是 USDC；真实 USDT 结算需要支持 USDT 的 facilitator/网络，或者自托管 facilitator。

Base Sepolia 上有一个可公开 mint 的测试 USDT：`0x323e78f944A9a1FcF3a10efcC5319DBb0bB6e673`。x402 exact 的 Permit2 代理是 `0x402085c248EeA27D92E8b30b2C58ed07f9E20001`。2026-11-02 已用真实 facilitator 验证 Permit2 签名，返回 `permit2_insufficient_balance`，说明 wire 正确；结算还需要 payer 有测试 USDT，以及少量 Base Sepolia ETH 来调用 `mint` 和 `approve`。

## 迁移

迁移不在服务启动路径上：

```bash
make migrate-up
```

服务启动时会检查 `_sqlx_migrations` 的版本。版本落后会直接退出，避免出现 `/health` 正常但业务表不存在。

## 测试

```bash
make test
make check
```

测试全部离线。facilitator 用本地 Axum 测试服务器，SQLite 用临时文件。

## 真测试网验证

2026-11-02 在 Base Sepolia 用真实 `https://x402.org/facilitator` 跑通：

- 付款：0.001 USDC（1000 atomic）
- tx：`0xe165fbcc6b71a40274dedbc30d688421da7fe807948ce01f821aab39cc7357bd`
- 网关返回 200，账本 `status=served`
- 付款方 20 → 19.999 USDC，收款方 0 → 0.001 USDC

USDT 的真实结算没有跑：公共 facilitator 的 `exact` 只列出 `eip155:84532`，默认资产是 USDC。Permit2 路径由 `permit2_payment_is_served` 测试覆盖；真实 USDT 需要支持 USDT 的 facilitator/网络，或自托管 facilitator。

## 限制

- mock facilitator 不验签，不碰链。真实 Base Sepolia 结算需要付款钱包里有测试网 USDC。
- 公共 `x402.org` facilitator 目前只列出 Base Sepolia 的 USDC；USDT 需要支持 Permit2 和对应资产的 facilitator/网络。
- 只实现 SQLite，Postgres 是后续工作。
- 只做支付，不代理模型，不处理 SSE，不绑定会话。
- x402 v2 的 wire 类型已对照官方 `@x402/core` 2.29.0 类型定义；仍接受 v1 的 `X-PAYMENT` 请求头，但 402 挑战是 v2 格式。
- 不接 `docker-compose.yml`、website-rs 或 Cloudflare。需要部署时再单独做。
