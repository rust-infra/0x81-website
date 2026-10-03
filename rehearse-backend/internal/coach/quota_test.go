package coach

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/0x81/rehearse-backend/internal/store/storetest"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------- 日界

// 对齐 Rust 的 `day_key_uses_utc_plus_eight`（`coach_quota.rs:136`）。
func TestDayKeyUsesUTCPlusEight(t *testing.T) {
	utc, err := time.Parse(time.RFC3339, "2026-09-27T17:00:00Z")
	require.NoError(t, err)
	// 2026-09-27T17:00:00Z == 2026-09-28 01:00 +08:00
	require.Equal(t, "2026-09-28", dayKeyString(utc), "day key")
	require.Equal(t, "2026-09-29T00:00:00+08:00", resetsAt(utc).Format(time.RFC3339), "resets_at")
}

// 对齐 Rust 的 `day_key_before_midnight_stays_on_same_day`。
func TestDayKeyBeforeMidnightStaysOnSameDay(t *testing.T) {
	utc, err := time.Parse(time.RFC3339, "2026-09-27T15:59:00Z")
	require.NoError(t, err)
	// 15:59Z == 23:59 +08:00，仍是 27 日
	require.Equal(t, "2026-09-27", dayKeyString(utc), "day key")
}

// ResetsAt 必须落在 UTC+8 的零点，而不是 UTC 零点——差 8 小时是最容易犯的错。
func TestResetsAtIsLocalMidnightNotUTCMidnight(t *testing.T) {
	utc, err := time.Parse(time.RFC3339, "2026-09-27T17:00:00Z")
	require.NoError(t, err)
	resets := resetsAt(utc)
	hour, minute, second := resets.Clock()
	require.Truef(t, hour == 0 && minute == 0 && second == 0,
		"resets_at 的时刻 = %02d:%02d:%02d，期望 00:00:00", hour, minute, second)
	_, offset := resets.Zone()
	require.Equal(t, 8*60*60, offset, "resets_at 偏移 期望 28800")
	// UTC+8 的 9/29 零点 = UTC 的 9/28 16:00。若误用 UTC 构造，这里会得到
	// 2026-09-29T00:00:00Z —— 整整差 8 小时。
	want := time.Date(2026, 9, 28, 16, 0, 0, 0, time.UTC)
	require.WithinDurationf(t, want, resets, 0, "resets_at = %s，期望 %s",
		resets.UTC().Format(time.RFC3339), want.Format(time.RFC3339))
}

// DayKey 落到 PG 的 DATE 列时只有年月日会被取走，所以必须是 UTC 零点构造。
func TestDayKeyIsUTCConstructed(t *testing.T) {
	utc, err := time.Parse(time.RFC3339, "2026-09-27T17:00:00Z")
	require.NoError(t, err)
	key := dayKey(utc)
	require.Same(t, time.UTC, key.Location(), "location 期望 UTC")
	year, month, day := key.Date()
	require.Truef(t, year == 2026 && month == 9 && day == 28, "date = %d-%d-%d，期望 2026-9-28", year, month, day)
}

// ---------------------------------------------------------------- 设置

// ⚠️ 这条是本次移植最容易丢的护栏：`{"enabled":true}` 缺 daily_turn_limit 时，
// 朴素解码会得到 0 = 不限量。必须取默认值 100。
func TestSettingsMissingLimitFallsBackToDefaultNotUnlimited(t *testing.T) {
	var settings QuotaSettings
	require.NoError(t, json.Unmarshal([]byte(`{"enabled":true}`), &settings))
	require.Equal(t, DefaultDailyTurnLimit, settings.DailyTurnLimit,
		"daily_turn_limit（0 会被读成「不限量」）")
	require.True(t, settings.Enabled, "enabled 应当为 true")
}

// 空对象也走默认值。
func TestSettingsEmptyObjectUsesDefaults(t *testing.T) {
	var settings QuotaSettings
	require.NoError(t, json.Unmarshal([]byte(`{}`), &settings))
	require.Equal(t, DefaultQuotaSettings(), settings, "settings")
}

// 显式给 0 仍然是不限量——那是产品语义，不能被默认值覆盖。
func TestSettingsExplicitZeroStaysUnlimited(t *testing.T) {
	var settings QuotaSettings
	require.NoError(t, json.Unmarshal([]byte(`{"daily_turn_limit":0,"enabled":true}`), &settings))
	require.Zero(t, settings.DailyTurnLimit, "daily_turn_limit")
}

// 对齐 Rust 的 `clamps_limit_into_range`（`coach_settings.rs:53`）。
func TestClampLimitIntoRange(t *testing.T) {
	require.Equal(t, MaxDailyTurnLimit,
		(QuotaSettings{DailyTurnLimit: 999_999, Enabled: true}).Clamp().DailyTurnLimit, "clamp 上界")
	require.Zero(t, (QuotaSettings{DailyTurnLimit: 0, Enabled: true}).Clamp().DailyTurnLimit, "0 不该被夹取")
	require.False(t, (QuotaSettings{DailyTurnLimit: 100, Enabled: false}).Clamp().Enabled,
		"enabled 不该被 clamp 改动")
}

// 对齐 Rust 的 `zero_limit_means_unlimited` / `exceeded_when_enabled_and_at_limit` /
// `disabled_means_unlimited`。
func TestQuotaWouldExceed(t *testing.T) {
	unlimited := QuotaSettings{DailyTurnLimit: 0, Enabled: true}
	_, exceeded := quotaWouldExceed(unlimited, 999_999)
	require.False(t, exceeded, "limit=0 应当不限量")
	limited := QuotaSettings{DailyTurnLimit: 100, Enabled: true}
	_, exceeded = quotaWouldExceed(limited, 99)
	require.False(t, exceeded, "第 99 次不该被拒")
	limit, exceeded := quotaWouldExceed(limited, 100)
	require.True(t, exceeded, "第 100 次应当被拒")
	require.Equal(t, uint32(100), limit, "第 100 次应当报出 limit=100")
	disabled := QuotaSettings{DailyTurnLimit: 100, Enabled: false}
	_, exceeded = quotaWouldExceed(disabled, 100)
	require.False(t, exceeded, "enabled=false 应当不限量")
}

// ---------------------------------------------------------------- 服务

func TestSettingsFallsBackToDefaultWhenUnset(t *testing.T) {
	service := NewQuotaService(storetest.New())
	settings, err := service.Settings(context.Background())
	require.NoError(t, err)
	require.Equal(t, DefaultQuotaSettings(), settings, "settings 期望默认值")
}

func TestSettingsFallsBackToDefaultOnBadJSON(t *testing.T) {
	st := storetest.New()
	st.SetSetting(quotaSettingKey, "{not json")
	settings, err := NewQuotaService(st).Settings(context.Background())
	require.NoError(t, err)
	require.Equal(t, DefaultQuotaSettings(), settings, "坏 JSON 应当回默认值")
}

func TestUpdateSettingsClampsAndPersists(t *testing.T) {
	st := storetest.New()
	service := NewQuotaService(st)
	saved, err := service.UpdateSettings(context.Background(), QuotaSettings{DailyTurnLimit: 999_999, Enabled: true})
	require.NoError(t, err)
	require.Equal(t, MaxDailyTurnLimit, saved.DailyTurnLimit, "保存后的上限")
	reloaded, err := service.Settings(context.Background())
	require.NoError(t, err)
	require.Equal(t, saved, reloaded, "读回")
}

// 消费到上限后必须返回 429，且带上 limit / used / resets_at（§7.6 的信封）。
func TestCheckAndConsumeReturnsQuotaExceededAtLimit(t *testing.T) {
	st := storetest.New()
	st.SetSetting(quotaSettingKey, `{"daily_turn_limit":2,"enabled":true}`)
	service := NewQuotaService(st)
	ctx := context.Background()

	for i := 1; i <= 2; i++ {
		require.NoErrorf(t, service.CheckAndConsume(ctx, "usr_1"), "第 %d 次消费不该失败", i)
	}
	err := service.CheckAndConsume(ctx, "usr_1")
	require.Error(t, err, "第 3 次消费应当失败")
	var apiErr *middleware.APIError
	require.ErrorAs(t, err, &apiErr, "期望 *middleware.APIError")
	require.Equal(t, 429, apiErr.Status, "status")
	require.Equal(t, "rehearse_quota_exceeded", apiErr.Reason, "reason")
	require.Equal(t, uint32(2), apiErr.Extra["limit"], "extra limit")
	require.Equal(t, uint32(2), apiErr.Extra["used"], "extra used")
	_, ok := apiErr.Extra["resets_at"].(string)
	require.True(t, ok, "extra 缺少 resets_at 字符串")
}

// 超限时不能消费：被拒之后用量必须停在 limit，不能悄悄涨上去。
func TestCheckAndConsumeDoesNotIncrementWhenRejected(t *testing.T) {
	st := storetest.New()
	st.SetSetting(quotaSettingKey, `{"daily_turn_limit":1,"enabled":true}`)
	service := NewQuotaService(st)
	ctx := context.Background()

	require.NoError(t, service.CheckAndConsume(ctx, "usr_1"))
	for i := 0; i < 3; i++ {
		require.Error(t, service.CheckAndConsume(ctx, "usr_1"), "超限后不该成功")
	}
	used := st.Usage("usr_1", dayKey(time.Now()))
	require.Equal(t, uint32(1), used, "被拒 3 次后用量 期望仍是 1")
}

// limit=0 时 CheckAndConsume 永远成功，且仍然计数（快照要能显示用量）。
func TestCheckAndConsumeUnlimitedStillCounts(t *testing.T) {
	st := storetest.New()
	st.SetSetting(quotaSettingKey, `{"daily_turn_limit":0,"enabled":true}`)
	service := NewQuotaService(st)
	ctx := context.Background()

	for i := 1; i <= 5; i++ {
		require.NoErrorf(t, service.CheckAndConsume(ctx, "usr_1"), "第 %d 次不该失败", i)
	}
	snapshot, err := service.Snapshot(ctx, "usr_1")
	require.NoError(t, err)
	require.Equal(t, uint32(5), snapshot.Used, "used")
	require.Nil(t, snapshot.Remaining, "不限量时 remaining 应当是 null")
}

// 快照：剩余量、重置时刻、以及「不限量」与「剩余 0」的区别。
func TestSnapshotReportsRemainingAndresetsAt(t *testing.T) {
	st := storetest.New()
	st.SetSetting(quotaSettingKey, `{"daily_turn_limit":10,"enabled":true}`)
	service := NewQuotaService(st)
	ctx := context.Background()

	for i := 0; i < 4; i++ {
		require.NoError(t, service.CheckAndConsume(ctx, "usr_1"))
	}
	snapshot, err := service.Snapshot(ctx, "usr_1")
	require.NoError(t, err)
	require.Equal(t, uint32(10), snapshot.Limit, "snapshot limit")
	require.Equal(t, uint32(4), snapshot.Used, "snapshot used")
	require.NotNil(t, snapshot.Remaining, "remaining")
	require.Equal(t, uint32(6), *snapshot.Remaining, "remaining")
	require.True(t, snapshot.Enabled, "enabled 应当为 true")
	resets, err := time.Parse(time.RFC3339, snapshot.ResetsAt)
	require.NoErrorf(t, err, "resets_at %q 不是 RFC3339", snapshot.ResetsAt)
	_, offset := resets.Zone()
	require.Equal(t, 8*60*60, offset, "resets_at 偏移 期望 28800")
}

// 用满之后 remaining 是 0 而不是 null —— 与「不限量」必须能区分开。
func TestSnapshotRemainingIsZeroNotNilWhenExhausted(t *testing.T) {
	st := storetest.New()
	st.SetSetting(quotaSettingKey, `{"daily_turn_limit":1,"enabled":true}`)
	service := NewQuotaService(st)
	ctx := context.Background()

	require.NoError(t, service.CheckAndConsume(ctx, "usr_1"))
	snapshot, err := service.Snapshot(ctx, "usr_1")
	require.NoError(t, err)
	require.NotNil(t, snapshot.Remaining, "用满时 remaining 应当是 0，不是 null")
	require.Zero(t, *snapshot.Remaining, "remaining")
}

// ⚠️ `enabled == false` 必须真的走「不限量」那条路。
//
// 这条是被独立审计抓出来的：`Enabled` 曾经只出现在 Snapshot 与测试用的
// `quotaWouldExceed` 里，`CheckAndConsume` 根本没读它——于是管理端把开关关掉
// 之后，服务端照样按 daily_turn_limit 返回 429。字段存在、快照也显示
// enabled=false，但限流照旧，属于典型的「有护栏的样子、没有护栏的作用」。
func TestCheckAndConsumeUnlimitedWhenDisabled(t *testing.T) {
	st := storetest.New()
	st.SetSetting(quotaSettingKey, `{"daily_turn_limit":1,"enabled":false}`)
	service := NewQuotaService(st)
	ctx := context.Background()

	for i := 1; i <= 5; i++ {
		require.NoErrorf(t, service.CheckAndConsume(ctx, "usr_1"), "第 %d 次不该失败（配额已关闭）", i)
	}
	// 关掉的是限流，不是计数：快照仍要显示用量。
	snapshot, err := service.Snapshot(ctx, "usr_1")
	require.NoError(t, err)
	require.Equal(t, uint32(5), snapshot.Used, "used（关闭配额后仍要计数）")
	require.False(t, snapshot.Enabled, "enabled 应当为 false")
}
