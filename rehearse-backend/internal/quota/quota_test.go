package quota

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/0x81/rehearse-backend/internal/store/storetest"
)

// ---------------------------------------------------------------- 日界

// 对齐 Rust 的 `day_key_uses_utc_plus_eight`（`coach_quota.rs:136`）。
func TestDayKeyUsesUTCPlusEight(t *testing.T) {
	utc, err := time.Parse(time.RFC3339, "2026-09-27T17:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	// 2026-09-27T17:00:00Z == 2026-09-28 01:00 +08:00
	if got := DayKeyString(utc); got != "2026-09-28" {
		t.Fatalf("day key = %q，期望 2026-09-28", got)
	}
	if got := ResetsAt(utc).Format(time.RFC3339); got != "2026-09-29T00:00:00+08:00" {
		t.Fatalf("resets_at = %q，期望 2026-09-29T00:00:00+08:00", got)
	}
}

// 对齐 Rust 的 `day_key_before_midnight_stays_on_same_day`。
func TestDayKeyBeforeMidnightStaysOnSameDay(t *testing.T) {
	utc, err := time.Parse(time.RFC3339, "2026-09-27T15:59:00Z")
	if err != nil {
		t.Fatal(err)
	}
	// 15:59Z == 23:59 +08:00，仍是 27 日
	if got := DayKeyString(utc); got != "2026-09-27" {
		t.Fatalf("day key = %q，期望 2026-09-27", got)
	}
}

// ResetsAt 必须落在 UTC+8 的零点，而不是 UTC 零点——差 8 小时是最容易犯的错。
func TestResetsAtIsLocalMidnightNotUTCMidnight(t *testing.T) {
	utc, err := time.Parse(time.RFC3339, "2026-09-27T17:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	resets := ResetsAt(utc)
	hour, minute, second := resets.Clock()
	if hour != 0 || minute != 0 || second != 0 {
		t.Fatalf("resets_at 的时刻 = %02d:%02d:%02d，期望 00:00:00", hour, minute, second)
	}
	_, offset := resets.Zone()
	if offset != 8*60*60 {
		t.Fatalf("resets_at 偏移 = %d 秒，期望 28800", offset)
	}
	// UTC+8 的 9/29 零点 = UTC 的 9/28 16:00。若误用 UTC 构造，这里会得到
	// 2026-09-29T00:00:00Z —— 整整差 8 小时。
	want := time.Date(2026, 9, 28, 16, 0, 0, 0, time.UTC)
	if !resets.Equal(want) {
		t.Fatalf("resets_at = %s，期望 %s", resets.UTC().Format(time.RFC3339), want.Format(time.RFC3339))
	}
}

// DayKey 落到 PG 的 DATE 列时只有年月日会被取走，所以必须是 UTC 零点构造。
func TestDayKeyIsUTCConstructed(t *testing.T) {
	utc, err := time.Parse(time.RFC3339, "2026-09-27T17:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	key := DayKey(utc)
	if key.Location() != time.UTC {
		t.Fatalf("location = %v，期望 UTC", key.Location())
	}
	if year, month, day := key.Date(); year != 2026 || month != 9 || day != 28 {
		t.Fatalf("date = %d-%d-%d，期望 2026-9-28", year, month, day)
	}
}

// ---------------------------------------------------------------- 设置

// ⚠️ 这条是本次移植最容易丢的护栏：`{"enabled":true}` 缺 daily_turn_limit 时，
// 朴素解码会得到 0 = 不限量。必须取默认值 100。
func TestSettingsMissingLimitFallsBackToDefaultNotUnlimited(t *testing.T) {
	var settings Settings
	if err := json.Unmarshal([]byte(`{"enabled":true}`), &settings); err != nil {
		t.Fatal(err)
	}
	if settings.DailyTurnLimit != DefaultDailyTurnLimit {
		t.Fatalf("daily_turn_limit = %d，期望 %d（0 会被读成「不限量」）",
			settings.DailyTurnLimit, DefaultDailyTurnLimit)
	}
	if !settings.Enabled {
		t.Fatal("enabled 应当为 true")
	}
}

// 空对象也走默认值。
func TestSettingsEmptyObjectUsesDefaults(t *testing.T) {
	var settings Settings
	if err := json.Unmarshal([]byte(`{}`), &settings); err != nil {
		t.Fatal(err)
	}
	if settings != DefaultSettings() {
		t.Fatalf("settings = %+v，期望 %+v", settings, DefaultSettings())
	}
}

// 显式给 0 仍然是不限量——那是产品语义，不能被默认值覆盖。
func TestSettingsExplicitZeroStaysUnlimited(t *testing.T) {
	var settings Settings
	if err := json.Unmarshal([]byte(`{"daily_turn_limit":0,"enabled":true}`), &settings); err != nil {
		t.Fatal(err)
	}
	if settings.DailyTurnLimit != 0 {
		t.Fatalf("daily_turn_limit = %d，期望 0", settings.DailyTurnLimit)
	}
}

// 对齐 Rust 的 `clamps_limit_into_range`（`coach_settings.rs:53`）。
func TestClampLimitIntoRange(t *testing.T) {
	if got := (Settings{DailyTurnLimit: 999_999, Enabled: true}).Clamp().DailyTurnLimit; got != MaxDailyTurnLimit {
		t.Fatalf("clamp 上界 = %d，期望 %d", got, MaxDailyTurnLimit)
	}
	if got := (Settings{DailyTurnLimit: 0, Enabled: true}).Clamp().DailyTurnLimit; got != 0 {
		t.Fatalf("0 不该被夹取，得到 %d", got)
	}
	if (Settings{DailyTurnLimit: 100, Enabled: false}).Clamp().Enabled {
		t.Fatal("enabled 不该被 clamp 改动")
	}
}

// 对齐 Rust 的 `zero_limit_means_unlimited` / `exceeded_when_enabled_and_at_limit` /
// `disabled_means_unlimited`。
func TestWouldExceed(t *testing.T) {
	unlimited := Settings{DailyTurnLimit: 0, Enabled: true}
	if _, exceeded := WouldExceed(unlimited, 999_999); exceeded {
		t.Fatal("limit=0 应当不限量")
	}
	limited := Settings{DailyTurnLimit: 100, Enabled: true}
	if _, exceeded := WouldExceed(limited, 99); exceeded {
		t.Fatal("第 99 次不该被拒")
	}
	if limit, exceeded := WouldExceed(limited, 100); !exceeded || limit != 100 {
		t.Fatalf("第 100 次应当被拒且报出 limit=100，得到 (%d, %v)", limit, exceeded)
	}
	disabled := Settings{DailyTurnLimit: 100, Enabled: false}
	if _, exceeded := WouldExceed(disabled, 100); exceeded {
		t.Fatal("enabled=false 应当不限量")
	}
}

// ---------------------------------------------------------------- 服务

func TestSettingsFallsBackToDefaultWhenUnset(t *testing.T) {
	service := New(storetest.New())
	settings, err := service.Settings(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if settings != DefaultSettings() {
		t.Fatalf("settings = %+v，期望默认值 %+v", settings, DefaultSettings())
	}
}

func TestSettingsFallsBackToDefaultOnBadJSON(t *testing.T) {
	st := storetest.New()
	st.SetSetting(SettingKey, "{not json")
	settings, err := New(st).Settings(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if settings != DefaultSettings() {
		t.Fatalf("坏 JSON 应当回默认值，得到 %+v", settings)
	}
}

func TestUpdateSettingsClampsAndPersists(t *testing.T) {
	st := storetest.New()
	service := New(st)
	saved, err := service.UpdateSettings(context.Background(), Settings{DailyTurnLimit: 999_999, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if saved.DailyTurnLimit != MaxDailyTurnLimit {
		t.Fatalf("保存后 = %d，期望 %d", saved.DailyTurnLimit, MaxDailyTurnLimit)
	}
	reloaded, err := service.Settings(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if reloaded != saved {
		t.Fatalf("读回 = %+v，期望 %+v", reloaded, saved)
	}
}

// 消费到上限后必须返回 429，且带上 limit / used / resets_at（§7.6 的信封）。
func TestCheckAndConsumeReturnsQuotaExceededAtLimit(t *testing.T) {
	st := storetest.New()
	st.SetSetting(SettingKey, `{"daily_turn_limit":2,"enabled":true}`)
	service := New(st)
	ctx := context.Background()

	for i := 1; i <= 2; i++ {
		if err := service.CheckAndConsume(ctx, "usr_1"); err != nil {
			t.Fatalf("第 %d 次消费不该失败：%v", i, err)
		}
	}
	err := service.CheckAndConsume(ctx, "usr_1")
	if err == nil {
		t.Fatal("第 3 次消费应当失败")
	}
	apiErr, ok := err.(*middleware.APIError)
	if !ok {
		t.Fatalf("错误类型 = %T，期望 *middleware.APIError", err)
	}
	if apiErr.Status != 429 {
		t.Fatalf("status = %d，期望 429", apiErr.Status)
	}
	if apiErr.Reason != "rehearse_quota_exceeded" {
		t.Fatalf("reason = %q，期望 rehearse_quota_exceeded", apiErr.Reason)
	}
	if apiErr.Extra["limit"] != uint32(2) || apiErr.Extra["used"] != uint32(2) {
		t.Fatalf("extra = %+v，期望 limit=2 used=2", apiErr.Extra)
	}
	if _, ok := apiErr.Extra["resets_at"].(string); !ok {
		t.Fatalf("extra 缺少 resets_at 字符串：%+v", apiErr.Extra)
	}
}

// 超限时不能消费：被拒之后用量必须停在 limit，不能悄悄涨上去。
func TestCheckAndConsumeDoesNotIncrementWhenRejected(t *testing.T) {
	st := storetest.New()
	st.SetSetting(SettingKey, `{"daily_turn_limit":1,"enabled":true}`)
	service := New(st)
	ctx := context.Background()

	if err := service.CheckAndConsume(ctx, "usr_1"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if err := service.CheckAndConsume(ctx, "usr_1"); err == nil {
			t.Fatal("超限后不该成功")
		}
	}
	if used := st.Usage("usr_1", DayKey(time.Now())); used != 1 {
		t.Fatalf("被拒 3 次后用量 = %d，期望仍是 1", used)
	}
}

// limit=0 时 CheckAndConsume 永远成功，且仍然计数（快照要能显示用量）。
func TestCheckAndConsumeUnlimitedStillCounts(t *testing.T) {
	st := storetest.New()
	st.SetSetting(SettingKey, `{"daily_turn_limit":0,"enabled":true}`)
	service := New(st)
	ctx := context.Background()

	for i := 1; i <= 5; i++ {
		if err := service.CheckAndConsume(ctx, "usr_1"); err != nil {
			t.Fatalf("第 %d 次不该失败：%v", i, err)
		}
	}
	snapshot, err := service.Snapshot(ctx, "usr_1")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Used != 5 {
		t.Fatalf("used = %d，期望 5", snapshot.Used)
	}
	if snapshot.Remaining != nil {
		t.Fatalf("不限量时 remaining 应当是 null，得到 %d", *snapshot.Remaining)
	}
}

// 快照：剩余量、重置时刻、以及「不限量」与「剩余 0」的区别。
func TestSnapshotReportsRemainingAndResetsAt(t *testing.T) {
	st := storetest.New()
	st.SetSetting(SettingKey, `{"daily_turn_limit":10,"enabled":true}`)
	service := New(st)
	ctx := context.Background()

	for i := 0; i < 4; i++ {
		if err := service.CheckAndConsume(ctx, "usr_1"); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := service.Snapshot(ctx, "usr_1")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Limit != 10 || snapshot.Used != 4 {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	if snapshot.Remaining == nil || *snapshot.Remaining != 6 {
		t.Fatalf("remaining = %v，期望 6", snapshot.Remaining)
	}
	if !snapshot.Enabled {
		t.Fatal("enabled 应当为 true")
	}
	resets, err := time.Parse(time.RFC3339, snapshot.ResetsAt)
	if err != nil {
		t.Fatalf("resets_at %q 不是 RFC3339：%v", snapshot.ResetsAt, err)
	}
	if _, offset := resets.Zone(); offset != 8*60*60 {
		t.Fatalf("resets_at 偏移 = %d，期望 28800", offset)
	}
}

// 用满之后 remaining 是 0 而不是 null —— 与「不限量」必须能区分开。
func TestSnapshotRemainingIsZeroNotNilWhenExhausted(t *testing.T) {
	st := storetest.New()
	st.SetSetting(SettingKey, `{"daily_turn_limit":1,"enabled":true}`)
	service := New(st)
	ctx := context.Background()

	if err := service.CheckAndConsume(ctx, "usr_1"); err != nil {
		t.Fatal(err)
	}
	snapshot, err := service.Snapshot(ctx, "usr_1")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Remaining == nil {
		t.Fatal("用满时 remaining 应当是 0，不是 null")
	}
	if *snapshot.Remaining != 0 {
		t.Fatalf("remaining = %d，期望 0", *snapshot.Remaining)
	}
}
