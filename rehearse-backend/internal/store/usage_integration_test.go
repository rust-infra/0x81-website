package store_test

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/0x81/rehearse-backend/internal/store"
)

// 这一组是**集成测试**：需要真的 Postgres，所以默认跳过。
//
// 为什么不能像 Rust 侧那样用内存库跑：Rust 的
// `coach_usage_try_consume_caps_concurrent_increments`（`sqlite.rs:4438`）
// 用的是内存 SQLite，而 Rehearse 的存储是**托管的 Postgres**——没有进程内的
// 等价物。所以这条验收（§13「配额原子性」）只能在真库上跑。
//
// 跑法：
//
//	export REHEARSE_TEST_DATABASE_URL='postgres://...'
//	go test ./internal/store/ -run Integration -v
//
// 表要先建好（`go run ./cmd/migrate up`）。测试只用自己的 user_id 前缀，
// 结束时清理自己写的行，不碰别的数据。
func testStore(t *testing.T) *store.Postgres {
	t.Helper()
	dsn := os.Getenv("REHEARSE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("REHEARSE_TEST_DATABASE_URL 未设置，跳过集成测试")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	st, err := store.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(st.Close)
	return st
}

// integrationUser 造一个不会与真实数据碰撞的 user_id。
//
// 刻意**不清理**：`Store` 接口没有暴露任意 SQL，而为了清理往接口上加一个
// `Delete` 只为测试服务不值得。残留行是 `itest_` 前缀，不会影响任何读路径
// （所有查询都是按 (user_id, day) 精确取）。
func integrationUser(t *testing.T) string {
	t.Helper()
	return "itest_" + t.Name() + "_" + time.Now().Format("150405.000000")
}

// 并发下当日计数不得超限——这是 §13 的硬验收，对应 Rust 侧
// `coach_usage_try_consume_caps_concurrent_increments`。
func TestIntegrationUsageTryConsumeCapsConcurrentIncrements(t *testing.T) {
	st := testStore(t)
	userID := integrationUser(t)
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
			if err != nil {
				t.Errorf("try consume: %v", err)
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

	if succeeded != limit {
		t.Fatalf("并发消费成功次数 = %d，期望恰好 %d（超了说明 check+increment 不是原子的）",
			succeeded, limit)
	}
	used, err := st.UsageGet(ctx, userID, day)
	if err != nil {
		t.Fatalf("usage get: %v", err)
	}
	if used != limit {
		t.Fatalf("turns_used = %d，期望 %d", used, limit)
	}
}

// 用量按 (user_id, day) 隔离：换一天归零、换用户归零。
func TestIntegrationUsageIsScopedByUserAndDay(t *testing.T) {
	st := testStore(t)
	userID := integrationUser(t)
	day := time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)
	nextDay := day.AddDate(0, 0, 1)

	ctx := context.Background()
	if used, err := st.UsageGet(ctx, userID, day); err != nil || used != 0 {
		t.Fatalf("初始用量 = %d, err = %v；期望 0, nil", used, err)
	}
	if used, err := st.UsageIncrement(ctx, userID, day); err != nil || used != 1 {
		t.Fatalf("第一次 increment = %d, err = %v；期望 1", used, err)
	}
	if used, err := st.UsageIncrement(ctx, userID, day); err != nil || used != 2 {
		t.Fatalf("第二次 increment = %d, err = %v；期望 2", used, err)
	}
	if used, err := st.UsageGet(ctx, userID, nextDay); err != nil || used != 0 {
		t.Fatalf("次日用量 = %d, err = %v；期望 0（日界隔离）", used, err)
	}
	if used, err := st.UsageGet(ctx, userID+"_other", day); err != nil || used != 0 {
		t.Fatalf("他人用量 = %d, err = %v；期望 0（用户隔离）", used, err)
	}
}

// limit == 0 表示不限量：不能因为 `turns_used < 0` 永远为假而把请求全拒掉。
func TestIntegrationUsageTryConsumeZeroLimitIsUnlimited(t *testing.T) {
	st := testStore(t)
	userID := integrationUser(t)
	day := time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)

	ctx := context.Background()
	for i := 1; i <= 5; i++ {
		used, ok, err := st.UsageTryConsume(ctx, userID, day, 0)
		if err != nil {
			t.Fatalf("try consume: %v", err)
		}
		if !ok {
			t.Fatalf("第 %d 次被拒——limit=0 应当不限量", i)
		}
		if used != uint32(i) {
			t.Fatalf("第 %d 次用量 = %d，期望 %d", i, used, i)
		}
	}
}

// 设置键：不存在返回哨兵错误，写入后能读回，重复写是 upsert。
func TestIntegrationSettingRoundTrip(t *testing.T) {
	st := testStore(t)
	key := integrationUser(t)
	ctx := context.Background()

	if _, err := st.SettingGet(ctx, key); err != store.ErrSettingNotFound {
		t.Fatalf("未写入时 err = %v，期望 ErrSettingNotFound", err)
	}
	if err := st.SettingPut(ctx, key, `{"daily_turn_limit":50,"enabled":true}`); err != nil {
		t.Fatalf("put: %v", err)
	}
	got, err := st.SettingGet(ctx, key)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got != `{"daily_turn_limit":50,"enabled":true}` {
		t.Fatalf("value = %q", got)
	}
	if err := st.SettingPut(ctx, key, `{"daily_turn_limit":80,"enabled":false}`); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	got, err = st.SettingGet(ctx, key)
	if err != nil {
		t.Fatalf("get after upsert: %v", err)
	}
	if got != `{"daily_turn_limit":80,"enabled":false}` {
		t.Fatalf("upsert 后 value = %q", got)
	}
}
