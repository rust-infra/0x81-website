package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// 本文件是 `rehearse_usage` 与 `rehearse_settings` 的 Postgres 实现。
//
// 语义逐条对齐 Rust 的 `CoachRepository`（`sqlite.rs:777-833`）与
// `SettingsRepository`，但**不是逐行翻译**——两处有意的差异：
//
//  1. `day` 在 Rust 里是 `'YYYY-MM-DD'` 字符串，靠约定保证格式；PG 侧是
//     `DATE`，由类型保证（写进一个非法日期会直接失败）。
//  2. 时间戳用 `now()` 而不是调用方传字符串：Rust 传的是 `Utc::now().to_rfc3339()`，
//     而这一列只是审计信息，没有比较逻辑；让数据库自己盖章少一个参数、
//     也少一处「调用方写错格式」的可能。
//
// ⚠️ `$2::date` 的显式转换是必要的，不是啰嗦：Supabase 的 transaction pooler
// 下 pgx 走 `exec` 模式（见 postgres.go 的说明），显式 cast 让参数类型不依赖
// 服务端的推断，行为在 pooler 与直连之间一致。

// UsageGet 见 `Store` 接口。
func (p *Postgres) UsageGet(ctx context.Context, userID string, day time.Time) (uint32, error) {
	var used int64
	err := p.pool.QueryRow(ctx,
		`SELECT turns_used FROM rehearse_usage WHERE user_id = $1 AND day = $2::date`,
		userID, day,
	).Scan(&used)
	if errors.Is(err, pgx.ErrNoRows) {
		// 没有记录 = 今天还没用过。这不是错误路径，是第一天/零点后的常态。
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("usage get: %w", err)
	}
	return clampNonNegative(used), nil
}

// UsageTryConsume 见 `Store` 接口。
//
// 实现要点：**一条语句**完成「检查 + 递增」，靠 `ON CONFLICT ... DO UPDATE`
// 的行锁串行化并发请求。`WHERE rehearse_usage.turns_used < $3` 不满足时
// 该行不会被更新，`RETURNING` 也就没有输出——这正是「已达上限」的信号。
func (p *Postgres) UsageTryConsume(
	ctx context.Context, userID string, day time.Time, limit uint32,
) (uint32, bool, error) {
	// limit == 0 是不限量：Rust 侧同样特判走 increment（`sqlite.rs:794`）。
	// 不能把 0 直接塞进 `turns_used < 0`——那会永远为假，把所有请求都拒掉。
	if limit == 0 {
		used, err := p.UsageIncrement(ctx, userID, day)
		if err != nil {
			return 0, false, err
		}
		return used, true, nil
	}

	var used int64
	err := p.pool.QueryRow(ctx,
		`INSERT INTO rehearse_usage (user_id, day, turns_used, updated_at)
		 VALUES ($1, $2::date, 1, now())
		 ON CONFLICT (user_id, day)
		 DO UPDATE SET turns_used = rehearse_usage.turns_used + 1, updated_at = now()
		 WHERE rehearse_usage.turns_used < $3
		 RETURNING turns_used`,
		userID, day, int64(limit),
	).Scan(&used)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("usage try consume: %w", err)
	}
	return clampNonNegative(used), true, nil
}

// UsageIncrement 见 `Store` 接口。
func (p *Postgres) UsageIncrement(ctx context.Context, userID string, day time.Time) (uint32, error) {
	var used int64
	err := p.pool.QueryRow(ctx,
		`INSERT INTO rehearse_usage (user_id, day, turns_used, updated_at)
		 VALUES ($1, $2::date, 1, now())
		 ON CONFLICT (user_id, day)
		 DO UPDATE SET turns_used = rehearse_usage.turns_used + 1, updated_at = now()
		 RETURNING turns_used`,
		userID, day,
	).Scan(&used)
	if err != nil {
		return 0, fmt.Errorf("usage increment: %w", err)
	}
	return clampNonNegative(used), nil
}

// SettingGet 见 `Store` 接口。
func (p *Postgres) SettingGet(ctx context.Context, key string) (string, error) {
	var value string
	err := p.pool.QueryRow(ctx,
		`SELECT value FROM rehearse_settings WHERE key = $1`, key,
	).Scan(&value)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrSettingNotFound
	}
	if err != nil {
		return "", fmt.Errorf("setting get: %w", err)
	}
	return value, nil
}

// SettingPut 见 `Store` 接口。
func (p *Postgres) SettingPut(ctx context.Context, key, value string) error {
	_, err := p.pool.Exec(ctx,
		`INSERT INTO rehearse_settings (key, value, updated_at)
		 VALUES ($1, $2, now())
		 ON CONFLICT (key)
		 DO UPDATE SET value = excluded.value, updated_at = now()`,
		key, value,
	)
	if err != nil {
		return fmt.Errorf("setting put: %w", err)
	}
	return nil
}

// clampNonNegative 防御 `turns_used < 0`。
//
// 表上已有 `CHECK (turns_used >= 0)`，所以正常路径不可能出现负数；这里只是
// 避免把负数静默转成巨大的 uint32（Go 的 int64 → uint32 转换会回绕）。
// Rust 侧同样有 `.max(0)`（`sqlite.rs:785`）。
func clampNonNegative(value int64) uint32 {
	if value < 0 {
		return 0
	}
	return uint32(value)
}
