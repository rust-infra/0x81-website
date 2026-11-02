package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// 本文件是 `rehearse_usage` 与 `rehearse_settings` 的 **SQLite** 实现。
// Postgres 侧在 `postgres_usage.go`——**两边的语义必须逐条一致**，
// 由 `store_conformance_test.go` 用同一组用例跑两个后端来保证。
//
// 与 Postgres 版的两处实现差异（不是语义差异）：
//
//  1. 占位符是 `?` 而不是 `$1`，也没有 `$2::date` 那种显式 cast——
//     SQLite 没有服务端参数类型推断，不存在 pooler 那类问题。
//  2. `day` 是 `'YYYY-MM-DD'` **文本**（SQLite 没有 DATE 类型）。
//     格式由 `sqliteDay` 统一产生，不靠调用方自觉——这与 Postgres 侧
//     靠列类型保证格式是同一个目的，只是手段不同。
//
// ⚠️ `ON CONFLICT ... DO UPDATE ... WHERE` 是**单条语句**，不是「先读再写」。
// SQLite 会先取写锁再执行，所以并发调用会被串行化，检查与递增之间没有窗口。
// 写成两条语句会在边界上放过去并发请求，实际用量超过配置上限。

const (
	sqliteSelectUsage = `SELECT turns_used FROM rehearse_usage WHERE user_id = ? AND day = ?`

	// 无条件加一次（配额关闭时走这条）。
	sqliteIncrementUsage = `
		INSERT INTO rehearse_usage (user_id, day, turns_used, updated_at)
		VALUES (?, ?, 1, CURRENT_TIMESTAMP)
		ON CONFLICT (user_id, day)
		DO UPDATE SET turns_used = rehearse_usage.turns_used + 1,
		              updated_at = CURRENT_TIMESTAMP
		RETURNING turns_used`

	// 检查并消费：`WHERE` 不满足时这一行既不会被插入也不会被更新，
	// `RETURNING` 因此没有输出——那正是「已达上限」的信号。
	// 尾部的 `?` 是 limit。
	sqliteTryConsumeUsage = `
		INSERT INTO rehearse_usage (user_id, day, turns_used, updated_at)
		VALUES (?, ?, 1, CURRENT_TIMESTAMP)
		ON CONFLICT (user_id, day)
		DO UPDATE SET turns_used = rehearse_usage.turns_used + 1,
		              updated_at = CURRENT_TIMESTAMP
		WHERE rehearse_usage.turns_used < ?
		RETURNING turns_used`

	sqliteSelectSetting = `SELECT value FROM rehearse_settings WHERE key = ?`

	sqliteUpsertSetting = `
		INSERT INTO rehearse_settings (key, value, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT (key)
		DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
)

// sqliteDay 把时间转成 `'YYYY-MM-DD'`。
//
// 时区**不在这里处理**：传进来的 `day` 已经是 quota 包算好的 UTC+8 自然日
// （`Store` 接口的约定），这里只负责格式。
func sqliteDay(day time.Time) string { return day.Format("2006-01-02") }

// UsageGet 见 `Store` 接口。
func (s *SQLite) UsageGet(ctx context.Context, userID string, day time.Time) (uint32, error) {
	var used int64
	err := s.db.QueryRowContext(ctx, sqliteSelectUsage, userID, sqliteDay(day)).Scan(&used)
	if errors.Is(err, sql.ErrNoRows) {
		// 没有记录 = 今天还没用过。这不是错误路径，是第一天/零点后的常态。
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("usage get: %w", err)
	}
	return clampNonNegative(used), nil
}

// UsageTryConsume 见 `Store` 接口。
func (s *SQLite) UsageTryConsume(
	ctx context.Context, userID string, day time.Time, limit uint32,
) (uint32, bool, error) {
	// limit == 0 是不限量。不能把 0 直接塞进 `turns_used < 0`——那会永远为假，
	// 把所有请求都拒掉。与 Postgres 侧同样的特判。
	if limit == 0 {
		used, err := s.UsageIncrement(ctx, userID, day)
		if err != nil {
			return 0, false, err
		}
		return used, true, nil
	}

	var used int64
	err := s.db.QueryRowContext(ctx, sqliteTryConsumeUsage,
		userID, sqliteDay(day), int64(limit),
	).Scan(&used)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("usage try consume: %w", err)
	}
	return clampNonNegative(used), true, nil
}

// UsageIncrement 见 `Store` 接口。
func (s *SQLite) UsageIncrement(ctx context.Context, userID string, day time.Time) (uint32, error) {
	var used int64
	err := s.db.QueryRowContext(ctx, sqliteIncrementUsage, userID, sqliteDay(day)).Scan(&used)
	if err != nil {
		return 0, fmt.Errorf("usage increment: %w", err)
	}
	return clampNonNegative(used), nil
}

// SettingGet 见 `Store` 接口。
func (s *SQLite) SettingGet(ctx context.Context, key string) (string, error) {
	var value string
	err := s.db.QueryRowContext(ctx, sqliteSelectSetting, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrSettingNotFound
	}
	if err != nil {
		return "", fmt.Errorf("setting get: %w", err)
	}
	return value, nil
}

// SettingPut 见 `Store` 接口。
func (s *SQLite) SettingPut(ctx context.Context, key, value string) error {
	if _, err := s.db.ExecContext(ctx, sqliteUpsertSetting, key, value); err != nil {
		return fmt.Errorf("setting put: %w", err)
	}
	return nil
}
