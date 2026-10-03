// Package quota 是每日用量配额：读管理端设置、按 UTC+8 划分自然日、原子消费一次。
//
// 移植自 `moyan-backend/src/services/coach_quota.rs`（174 行）。语义逐条对齐，
// 两处有意的差异写在各自的位置上。
package quota

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/0x81/rehearse-backend/internal/store"
)

// SettingKey 是配额设置在自己库里的键名。
//
// 由 `coach` 改名为 `rehearse`：`rehearse_settings` 是 Rehearse 独占的表，
// 键名再带 `coach` 只会让人以为它跟墨言有关系（§7.5 的路由改名同一套理由）。
const SettingKey = "rehearse"

// DefaultDailyTurnLimit 是没配置时的每日轮次上限（§7.8 的 Global Constraints）。
//
// 注意语义：**0 表示不限量**，不是「不给用」。所以这个默认值必须显式是 100，
// 不能靠 Go 的零值——见 `Settings.UnmarshalJSON`。
const DefaultDailyTurnLimit uint32 = 100

// MaxDailyTurnLimit 是管理端能设置的上限（`coach_settings.rs:9`）。
const MaxDailyTurnLimit uint32 = 100_000

// utc8 是配额日界用的固定时区。
//
// 用固定偏移而不是 `Asia/Shanghai`：后者依赖容器里有 tzdata，而最终镜像是
// `scratch`（**里面一个文件都没有**）。固定偏移在 1980 年之后的中国没有 DST，
// 语义上等价，且不需要任何外部数据。
var utc8 = time.FixedZone("UTC+8", 8*60*60)

// Settings 是配额设置。
type Settings struct {
	DailyTurnLimit uint32 `json:"daily_turn_limit"`
	Enabled        bool   `json:"enabled"`
}

// DefaultSettings 返回默认配额：每天 100 轮、启用。
func DefaultSettings() Settings {
	return Settings{DailyTurnLimit: DefaultDailyTurnLimit, Enabled: true}
}

// UnmarshalJSON 让**缺失的字段取默认值**，而不是 Go 的零值。
//
// ⚠️ 这不是洁癖，是一个会静默放大额度的坑：
//
//	`{"enabled": true}` —— 缺 `daily_turn_limit`
//	  · 朴素解码：DailyTurnLimit = 0 → 语义是「不限量」
//	  · 期望行为：100（Rust 侧 `#[serde(default = "default_daily_turn_limit")]`）
//
// 也就是说，管理端少发一个字段会把配额**关掉**，而两边都不会报错。
// 这类「悄悄丢掉护栏」正是 §7.8 点名的风险，所以用指针区分「没给」与「给了 0」。
// 显式给 `0` 仍然是不限量（那是产品语义，不是默认值）。
func (s *Settings) UnmarshalJSON(data []byte) error {
	var raw struct {
		DailyTurnLimit *uint32 `json:"daily_turn_limit"`
		Enabled        *bool   `json:"enabled"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	out := DefaultSettings()
	if raw.DailyTurnLimit != nil {
		out.DailyTurnLimit = *raw.DailyTurnLimit
	}
	if raw.Enabled != nil {
		out.Enabled = *raw.Enabled
	}
	*s = out
	return nil
}

// Clamp 把上限夹进允许范围（对齐 `coach_settings.rs:11` 的 clamp_settings）。
func (s Settings) Clamp() Settings {
	if s.DailyTurnLimit > MaxDailyTurnLimit {
		s.DailyTurnLimit = MaxDailyTurnLimit
	}
	return s
}

// DayKey 返回该时刻所属的 UTC+8 自然日。
//
// 返回值是「UTC 零点的那个日期」——因为落到 PG 的 `DATE` 列时，只有
// 年月日会被取走。构造时统一用 UTC，避免「同一个日期在两种时区下变成两天」。
func DayKey(now time.Time) time.Time {
	year, month, day := now.In(utc8).Date()
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}

// DayKeyString 是 DayKey 的 `YYYY-MM-DD` 形式，只用于日志与测试断言。
func DayKeyString(now time.Time) string { return DayKey(now).Format("2006-01-02") }

// ResetsAt 返回下一个 UTC+8 零点。
//
// ⚠️ 这里的 `time.Date` 用的是 **UTC+8 的 location**，不是 UTC。用 UTC 的话
// 会把「本地零点」当成 UTC 零点，结果偏移整整 8 小时——Rust 侧
// `day_key_uses_utc_plus_eight` 就是为了抓这个（`coach_quota.rs:51` 的注释）。
func ResetsAt(now time.Time) time.Time {
	year, month, day := now.In(utc8).Date()
	// day+1 由 time.Date 自行归一化（月末、年末都不用特判）。
	return time.Date(year, month, day+1, 0, 0, 0, 0, utc8)
}

// WouldExceed 判断给定用量是否已用尽。返回 `(limit, true)` 表示已用尽。
//
// 只给测试用（Rust 侧同样标了 `#[cfg(test)]`）：真实路径走
// `Store.UsageTryConsume` 的原子判断，不需要在应用层再算一遍——
// 那正是「读一次再写一次」的并发漏洞的入口。
func WouldExceed(settings Settings, used uint32) (uint32, bool) {
	if !settings.Enabled || settings.DailyTurnLimit == 0 {
		return 0, false
	}
	if used >= settings.DailyTurnLimit {
		return settings.DailyTurnLimit, true
	}
	return 0, false
}

// Snapshot 是 `GET /api/rehearse/quota` 的响应体。
//
// `Remaining` 用指针：不限量时是 `null`，与「剩余 0」是两种不同的意思。
type Snapshot struct {
	Limit     uint32  `json:"limit"`
	Used      uint32  `json:"used"`
	Remaining *uint32 `json:"remaining"`
	ResetsAt  string  `json:"resets_at"`
	Enabled   bool    `json:"enabled"`
}

// Service 是配额服务。
type Service struct {
	store store.Store
	// now 可注入，便于测试跨零点行为。
	now func() time.Time
}

// New 建一个配额服务。
func New(st store.Store) *Service {
	return &Service{store: st, now: time.Now}
}

// Settings 读配额设置；没配过或解析失败时返回默认值。
//
// 「解析失败就回默认」是沿用 Rust 的行为（`coach_quota.rs:84`）。差异只在
// 多打一条 warn：静默回默认会让「管理端写进去一个坏 JSON」表现成
// 「配额莫名其妙变回 100」，值得留一条线索。
func (s *Service) Settings(ctx context.Context) (Settings, error) {
	raw, err := s.store.SettingGet(ctx, SettingKey)
	if err != nil {
		if err == store.ErrSettingNotFound {
			return DefaultSettings(), nil
		}
		return Settings{}, err
	}
	var parsed Settings
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		slog.Warn("配额设置不是合法 JSON，回退到默认值",
			"key", SettingKey, "err", err, "fallback_limit", DefaultDailyTurnLimit)
		return DefaultSettings(), nil
	}
	return parsed.Clamp(), nil
}

// UpdateSettings 写入配额设置（管理端）。
func (s *Service) UpdateSettings(ctx context.Context, input Settings) (Settings, error) {
	settings := input.Clamp()
	encoded, err := json.Marshal(settings)
	if err != nil {
		return Settings{}, fmt.Errorf("marshal quota settings: %w", err)
	}
	if err := s.store.SettingPut(ctx, SettingKey, string(encoded)); err != nil {
		return Settings{}, err
	}
	return settings, nil
}

// Snapshot 返回当前用量快照。
func (s *Service) Snapshot(ctx context.Context, userID string) (Snapshot, error) {
	settings, err := s.Settings(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	now := s.now()
	used, err := s.store.UsageGet(ctx, userID, DayKey(now))
	if err != nil {
		return Snapshot{}, err
	}
	var remaining *uint32
	if settings.DailyTurnLimit != 0 {
		value := uint32(0)
		if settings.DailyTurnLimit > used {
			value = settings.DailyTurnLimit - used
		}
		remaining = &value
	}
	return Snapshot{
		Limit:     settings.DailyTurnLimit,
		Used:      used,
		Remaining: remaining,
		ResetsAt:  ResetsAt(now).Format(time.RFC3339),
		Enabled:   settings.Enabled,
	}, nil
}

// CheckAndConsume 检查并在有额度时消费一次；超限返回 429。
//
// ⚠️ 调用顺序有讲究：调用方必须**先**确认 LLM 已配置、**再**调这里。
// 反过来的话，服务没配好时用户会白白损失一次额度而且拿不到任何结果
// （Rust 侧的顺序见 `coach.rs:57-61`）。
func (s *Service) CheckAndConsume(ctx context.Context, userID string) error {
	settings, err := s.Settings(ctx)
	if err != nil {
		return err
	}
	now := s.now()
	day := DayKey(now)

	// 消费成功时的返回值这里用不上（客户端要的是快照，不是这一轮的序号），
	// 所以只取成功与否。失败时再单独读一次用量——原子消费那条语句在被
	// WHERE 挡下时没有输出，拿不到 used。
	_, ok, err := s.store.UsageTryConsume(ctx, userID, day, settings.DailyTurnLimit)
	if err != nil {
		return err
	}
	if ok {
		return nil
	}

	current, err := s.store.UsageGet(ctx, userID, day)
	if err != nil {
		return err
	}
	limit := settings.DailyTurnLimit
	if current > limit {
		current = limit
	}
	return middleware.QuotaExceeded(limit, current, ResetsAt(now).Format(time.RFC3339))
}
