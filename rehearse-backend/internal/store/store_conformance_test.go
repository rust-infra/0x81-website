package store_test

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/0x81/rehearse-backend/internal/migrate"
	"github.com/0x81/rehearse-backend/internal/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 这个文件是**后端无关的一致性测试**：同一组用例在两套实现上各跑一遍。
//
// 为什么必须两边都跑：`Store` 的接口注释写的是语义，不是实现。配额那条
// 「检查 + 递增必须原子」在两个后端里是靠**不同的 SQL** 表达的
// （PG 的 `ON CONFLICT ... WHERE ... RETURNING` 与 SQLite 的同名构造），
// 只测一边的话，另一边写错了没有任何信号——而错法（读一次再写一次）
// 在单线程测试里**照样通过**。
//
// SQLite 永远跑，用 `t.TempDir()` 里的**真文件**而不是 `:memory:`：
// 只有文件库才走真正的文件锁与 WAL，内存库的共享缓存是表级锁，
// 拿它测出来的「并发安全」不能代表生产（§7.3.1 记过这笔账）。
//
// Postgres 只在 `REHEARSE_TEST_DATABASE_URL` 设了时才跑。与旧版不同的是：
// **建表由测试自己做**，不再要求「先手动跑过 `go run ./cmd/migrate up`」——
// 那个前提很容易忘，忘了就是一串 `relation does not exist`，看起来像代码 bug。
func eachBackend(t *testing.T, fn func(t *testing.T, st store.Store, dialect store.Dialect)) {
	t.Helper()

	t.Run("sqlite", func(t *testing.T) {
		openBackend(t, "sqlite:"+filepath.Join(t.TempDir(), "rehearse.db"), fn)
	})

	if dsn := os.Getenv("REHEARSE_TEST_DATABASE_URL"); dsn != "" {
		t.Run("postgres", func(t *testing.T) {
			openBackend(t, dsn, fn)
		})
	} else {
		t.Log("REHEARSE_TEST_DATABASE_URL 未设置：只跑了 SQLite 后端")
	}
}

// openBackend 建连、跑迁移、把 Store 交给用例。
//
// ⚠️ 失败信息里**不带 DSN**：Postgres 的连接串含密码，testify 会把消息打进
// 测试输出，而 §13 的验收项要求任何输出都不出现凭据。
func openBackend(t *testing.T, dsn string, fn func(t *testing.T, st store.Store, dialect store.Dialect)) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	backend, err := store.Open(ctx, dsn)
	require.NoError(t, err, "open backend")
	t.Cleanup(backend.Close)

	runner, err := migrate.New(backend)
	require.NoError(t, err, "build migration runner")
	_, err = runner.Up(ctx)
	require.NoError(t, err, "apply migrations")

	fn(t, backend.Store, backend.Dialect)
}

// uniqueUser 造一个不会与真实数据碰撞的 user_id。
//
// 刻意**不清理**：`Store` 接口没有暴露任意 SQL，而为了清理往接口上加一个
// `Delete` 只为测试服务不值得。残留行是 `itest_` 前缀，不会影响任何读路径
// （所有查询都是按 (user_id, day) 精确取）。
func uniqueUser(t *testing.T) string {
	t.Helper()
	return "itest_" + t.Name() + "_" + time.Now().Format("150405.000000")
}

// 并发下当日计数不得超限——这是 §13 的硬验收，对应 Rust 侧
// `coach_usage_try_consume_caps_concurrent_increments`（`sqlite.rs:4438`）。
//
// 超了 = 「检查」与「递增」之间有一个窗口，也就是根本不是原子的。
func TestUsageTryConsumeCapsConcurrentIncrements(t *testing.T) {
	eachBackend(t, func(t *testing.T, st store.Store, dialect store.Dialect) {
		userID := uniqueUser(t)
		day := time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)

		const limit = 3
		const goroutines = 12

		ctx := context.Background()
		var (
			wg        sync.WaitGroup
			mu        sync.Mutex
			succeeded int
		)
		for range goroutines {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_, ok, err := st.UsageTryConsume(ctx, userID, day, limit)
				if !assert.NoError(t, err, "%s: try consume", dialect) {
					return
				}
				if ok {
					mu.Lock()
					succeeded++
					mu.Unlock()
				}
			}()
		}
		wg.Wait()

		require.Equalf(t, limit, succeeded,
			"%s: 并发消费成功次数（超了说明 check+increment 不是原子的）", dialect)
		used, err := st.UsageGet(ctx, userID, day)
		require.NoError(t, err, "%s: usage get", dialect)
		require.Equal(t, uint32(limit), used, "%s: turns_used", dialect)
	})
}

// 顺序调用的边界：第 limit 次成功、第 limit+1 次被拒，且被拒时**不写入**。
//
// 这一条比并发那条更容易漏：如果实现写成「先 SELECT 再无条件 UPDATE」，
// 单线程下第 limit+1 次会返回 false（看起来对）却已经把计数加到了 limit+1。
// 所以断言必须同时看返回值**和**落库的值。
func TestUsageTryConsumeStopsAtLimit(t *testing.T) {
	eachBackend(t, func(t *testing.T, st store.Store, dialect store.Dialect) {
		userID := uniqueUser(t)
		day := time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)
		ctx := context.Background()

		const limit = 2
		for i := uint32(1); i <= limit; i++ {
			used, ok, err := st.UsageTryConsume(ctx, userID, day, limit)
			require.NoErrorf(t, err, "%s: 第 %d 次", dialect, i)
			require.Truef(t, ok, "%s: 第 %d 次不该被拒", dialect, i)
			require.Equalf(t, i, used, "%s: 第 %d 次用量", dialect, i)
		}

		used, ok, err := st.UsageTryConsume(ctx, userID, day, limit)
		require.NoErrorf(t, err, "%s: 超限那次", dialect)
		require.False(t, ok, "%s: 超过上限应当被拒", dialect)
		require.Zero(t, used, "%s: 被拒时不该返回用量", dialect)

		stored, err := st.UsageGet(ctx, userID, day)
		require.NoErrorf(t, err, "%s: 被拒后查用量", dialect)
		require.Equalf(t, uint32(limit), stored, "%s: 被拒的那次**不该**写入", dialect)
	})
}

// 用量按 (user_id, day) 隔离：换一天归零、换用户归零。
func TestUsageIsScopedByUserAndDay(t *testing.T) {
	eachBackend(t, func(t *testing.T, st store.Store, dialect store.Dialect) {
		userID := uniqueUser(t)
		day := time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)
		nextDay := day.AddDate(0, 0, 1)

		ctx := context.Background()
		used, err := st.UsageGet(ctx, userID, day)
		require.NoError(t, err, "%s: 初始用量查询", dialect)
		require.Zero(t, used, "%s: 初始用量", dialect)

		used, err = st.UsageIncrement(ctx, userID, day)
		require.NoError(t, err, "%s: 第一次 increment", dialect)
		require.Equal(t, uint32(1), used, "%s: 第一次 increment", dialect)

		used, err = st.UsageIncrement(ctx, userID, day)
		require.NoError(t, err, "%s: 第二次 increment", dialect)
		require.Equal(t, uint32(2), used, "%s: 第二次 increment", dialect)

		used, err = st.UsageGet(ctx, userID, nextDay)
		require.NoError(t, err, "%s: 次日用量查询", dialect)
		require.Zero(t, used, "%s: 次日用量（日界隔离）", dialect)

		used, err = st.UsageGet(ctx, userID+"_other", day)
		require.NoError(t, err, "%s: 他人用量查询", dialect)
		require.Zero(t, used, "%s: 他人用量（用户隔离）", dialect)
	})
}

// limit == 0 表示不限量：不能因为 `turns_used < 0` 永远为假而把请求全拒掉。
func TestUsageTryConsumeZeroLimitIsUnlimited(t *testing.T) {
	eachBackend(t, func(t *testing.T, st store.Store, dialect store.Dialect) {
		userID := uniqueUser(t)
		day := time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)

		ctx := context.Background()
		for i := 1; i <= 5; i++ {
			used, ok, err := st.UsageTryConsume(ctx, userID, day, 0)
			require.NoErrorf(t, err, "%s: 第 %d 次 try consume", dialect, i)
			require.Truef(t, ok, "%s: 第 %d 次被拒——limit=0 应当不限量", dialect, i)
			require.Equalf(t, uint32(i), used, "%s: 第 %d 次用量", dialect, i)
		}
	})
}

// 设置键：不存在返回哨兵错误，写入后能读回，重复写是 upsert。
func TestSettingRoundTrip(t *testing.T) {
	eachBackend(t, func(t *testing.T, st store.Store, dialect store.Dialect) {
		key := uniqueUser(t)
		ctx := context.Background()

		_, err := st.SettingGet(ctx, key)
		require.ErrorIsf(t, err, store.ErrSettingNotFound,
			"%s: 未写入时应当返回 ErrSettingNotFound", dialect)

		require.NoError(t, st.SettingPut(ctx, key, `{"daily_turn_limit":50,"enabled":true}`),
			"%s: put", dialect)
		got, err := st.SettingGet(ctx, key)
		require.NoError(t, err, "%s: get", dialect)
		require.Equal(t, `{"daily_turn_limit":50,"enabled":true}`, got, "%s: value", dialect)

		require.NoError(t, st.SettingPut(ctx, key, `{"daily_turn_limit":80,"enabled":false}`),
			"%s: upsert", dialect)
		got, err = st.SettingGet(ctx, key)
		require.NoError(t, err, "%s: get after upsert", dialect)
		require.Equal(t, `{"daily_turn_limit":80,"enabled":false}`, got,
			"%s: upsert 后 value", dialect)
	})
}

// 用户设置文档：不存在返回哨兵错误，写入后读回同一份 JSON，重复写是 upsert。
// 与 TestSettingRoundTrip 的差别在键空间：这里按 JWT 的 sub 隔离，
// 两个用户互不可见。
//
// 断言用 JSONEq 而不是逐字比较：Postgres 的列是 JSONB，读回来是数据库
// 重新渲染的规范文本（键间有空格、顺序可能不同），逐字比较只对 SQLite 成立。
func TestUserSettingsRoundTrip(t *testing.T) {
	eachBackend(t, func(t *testing.T, st store.Store, dialect store.Dialect) {
		userA := uniqueUser(t)
		// 显式加后缀，不靠 uniqueUser 的微秒时间戳区分——连续两次调用可能落在
		// 同一微秒里，那样「两个用户互不可见」就退化成读自己。
		userB := uniqueUser(t) + "_b"
		ctx := context.Background()

		_, err := st.UserSettingsGet(ctx, userA)
		require.ErrorIsf(t, err, store.ErrUserSettingsNotFound,
			"%s: 未写入时应当返回 ErrUserSettingsNotFound", dialect)

		require.NoError(t, st.UserSettingsPut(ctx, userA, `{"theme":"dark","language":"en"}`),
			"%s: put", dialect)
		got, err := st.UserSettingsGet(ctx, userA)
		require.NoError(t, err, "%s: get", dialect)
		require.JSONEq(t, `{"theme":"dark","language":"en"}`, got, "%s: value", dialect)

		// 另一个用户读不到 A 的文档。
		_, err = st.UserSettingsGet(ctx, userB)
		require.ErrorIsf(t, err, store.ErrUserSettingsNotFound,
			"%s: 用户之间不共享设置", dialect)

		require.NoError(t, st.UserSettingsPut(ctx, userA, `{"theme":"light","language":"zh-CN"}`),
			"%s: upsert", dialect)
		got, err = st.UserSettingsGet(ctx, userA)
		require.NoError(t, err, "%s: get after upsert", dialect)
		require.JSONEq(t, `{"theme":"light","language":"zh-CN"}`, got,
			"%s: upsert 后 value", dialect)
	})
}
