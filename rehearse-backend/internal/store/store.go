// Package store 是 Rehearse 自己的持久层。
//
// 与 moyan-backend 的 `repositories/`（3 文件 6,597 行）不同，这里**故意很薄**：
// Rehearse 只碰自己那两张表（`rehearse_usage` / `rehearse_settings`），
// 没有共享表要迁就，所以不需要那套多后端抽象（§7.9 的对照表里
// `repositories/` 标注为「不移植」）。
//
// **两套实现（2026-10-10）**：`Postgres`（生产推荐，§7.3.2）与 `SQLite`
// （未设 `DATABASE_URL` 时的**默认**后端 / 单机部署 / 本地开发 / 测试，§7.3.5）。
// 接口刻意保持很小（额度三个方法 + 设置两对读写），两套实现加起来
// 不到 400 行——这正是当初「故意很薄」换来的东西：加一个后端是加法，
// 不是重写。
//
// 接口保留的另一个理由是让上层能被假实现替换（`storetest.Fake`，
// 用于不连库的单测）。
package store

import (
	"context"
	"errors"
	"time"
)

// ErrSettingNotFound 表示该键在 rehearse_settings 里没有值。
//
// 用哨兵错误而不是 `(value, ok)`：调用方几乎总是要「没有就用默认值」，
// 而默认值属于业务层（配额默认 100 次、LLM 配置回落到 env），
// 不该由存储层替它决定。
var ErrSettingNotFound = errors.New("setting not found")

// ErrUserSettingsNotFound 表示该用户还没有设置文档。
//
// 与 ErrSettingNotFound 同理：第一次登录的用户没有行，调用方（httpapi）
// 应当回一个空文档而不是 500。
var ErrUserSettingsNotFound = errors.New("user settings not found")

// Store 是持久层的接口。
type Store interface {
	// Ping 用于 `/health`：能区分「进程活着」和「依赖可用」。
	Ping(ctx context.Context) error
	// Close 释放连接池。
	Close()

	// UsageGet 读某用户某日的已用轮数。没有记录时返回 0（不是错误）。
	//
	// `day` 是 **UTC+8 自然日**，由 quota 包算好传进来——存储层不碰时区，
	// 免得「日界」这件事有两个真相源。
	UsageGet(ctx context.Context, userID string, day time.Time) (uint32, error)

	// UsageTryConsume 是**原子**的「检查并消费一次」。
	//
	// 返回 `(turnsUsed, true, nil)` 表示消费成功；`(0, false, nil)` 表示
	// 已达上限、**没有**消费。`limit == 0` 表示不限量，永远成功。
	//
	// ⚠️ 这个方法的原子性不是优化，是正确性：读一次再写一次的话，
	// 并发请求会在边界上一起通过，实际用量超过配置上限
	// （Rust 侧 `coach_usage_try_consume_caps_concurrent_increments`
	// 就是为这条写的测试，`sqlite.rs:4438`）。
	//
	// 两套实现都用**单条** `INSERT ... ON CONFLICT DO UPDATE ... WHERE`
	// 表达，靠数据库自身的行锁串行化；SQLite 侧这条路径由
	// `store_conformance_test.go` 在真文件上并发验证。
	UsageTryConsume(ctx context.Context, userID string, day time.Time, limit uint32) (uint32, bool, error)

	// UsageIncrement 无条件加一次，返回加完后的值。配额关闭时走这条。
	UsageIncrement(ctx context.Context, userID string, day time.Time) (uint32, error)

	// SettingGet 读一个设置键。键不存在时返回 `ErrSettingNotFound`。
	SettingGet(ctx context.Context, key string) (string, error)
	// SettingPut 写一个设置键（upsert）。
	SettingPut(ctx context.Context, key, value string) error

	// UserSettingsGet 读某用户的设置文档（JSON 字符串）。
	// 该用户从未写过时返回 `ErrUserSettingsNotFound`。
	UserSettingsGet(ctx context.Context, userSub string) (string, error)
	// UserSettingsPut 全量覆盖某用户的设置文档（upsert）。
	// `settings` 必须是合法 JSON——形状校验在 httpapi，存储层只保证存得进去、读得回来。
	UserSettingsPut(ctx context.Context, userSub, settings string) error
}

// Migrator 是 `cmd/migrate` 需要的存储能力。
//
// 单独一个接口而不是塞进 `Store`：server 运行时**不需要** DDL 能力
// （§7.9 的决定是「运行时无 DDL 权限」），把它挂在 Store 上等于让每个
// 读路径都拿着一个能 DROP TABLE 的句柄。分开之后，`cmd/migrate` 拿到的
// 才是迁移句柄，而 `cmd/rehearse` 拿到的只是 Store。
//
// 两套后端的 DDL 方言不同（`now()` vs `CURRENT_TIMESTAMP`、`TIMESTAMPTZ`
// vs `TEXT`），所以这里只抽象「怎么执行」，不抽象「执行什么」——
// SQL 文本按后端分目录（`migrations/postgres/` 与 `migrations/sqlite/`）。
type Migrator interface {
	// EnsureMigrationsTable 建 `schema_migrations`（幂等）。
	EnsureMigrationsTable(ctx context.Context) error
	// AppliedVersions 返回已应用的版本号集合。
	AppliedVersions(ctx context.Context) (map[string]bool, error)
	// ApplyMigration 在**一个事务**里执行 body 并记下 version。
	ApplyMigration(ctx context.Context, version, body string) error
}
