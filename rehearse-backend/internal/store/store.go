// Package store 是 Rehearse 自己的持久层。
//
// 与 moyan-backend 的 `repositories/`（3 文件 6,597 行）不同，这里**故意很薄**：
// Rehearse 只碰自己那两张表（`rehearse_usage` / `rehearse_settings`），
// 没有共享表要迁就，所以不需要那套多后端抽象（§7.9 的对照表里
// `repositories/` 标注为「不移植」）。
//
// 这个接口只有**一个**实现（`Postgres`）——§7.3.4 已决定不引入第二套存储后端。
// 保留接口是为了让上层能被假实现替换（测试、以及「不连库也能跑起来」）。
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
	UsageTryConsume(ctx context.Context, userID string, day time.Time, limit uint32) (uint32, bool, error)

	// UsageIncrement 无条件加一次，返回加完后的值。配额关闭时走这条。
	UsageIncrement(ctx context.Context, userID string, day time.Time) (uint32, error)

	// SettingGet 读一个设置键。键不存在时返回 `ErrSettingNotFound`。
	SettingGet(ctx context.Context, key string) (string, error)
	// SettingPut 写一个设置键（upsert）。
	SettingPut(ctx context.Context, key, value string) error
}
