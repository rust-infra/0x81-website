// Package settings 管理 Rehearse 自己的管理端设置。
//
// 现在只有 LLM 配置一项（配额设置按语义归 `quota` 包）。两者都存
// `rehearse_settings`，键名不同：`llm` 与 `rehearse`。
//
// 移植自 `moyan-backend/src/services/admin_collect.rs` 的 LLM 部分
// （`load_llm_settings` / `fill_from_env_if_empty` / `to_public` /
// `update_llm_settings`，:39-69、:511-524、:633-670）。
package settings

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/0x81/rehearse-backend/internal/config"
	"github.com/0x81/rehearse-backend/internal/llm"
	"github.com/0x81/rehearse-backend/internal/store"
)

// LLMKey 是 LLM 配置在 `rehearse_settings` 里的键名。
//
// 与墨言那边**同名**（`admin_collect.rs:21` 的 `llm`）是有意的：管理端是
// **一个表单双写两边**（§7.3.2），键名一致让「两边到底存了什么」可以逐字比对。
const LLMKey = "llm"

// 没配过时的兜底值，与 Rust 的 `fill_from_env_if_empty`（:639-657）一致。
//
// ⚠️ 这两个默认值是**继承来的**，不是重新设计的。它们的实际影响只在管理端
// 表单的初始值上——`llm.Settings.Configured()` 三项都要非空，而 API key
// 没有默认值，所以「没配」时仍然是 503。
//
// 反过来说，它们掩盖了一个场景：管理员只填了 API key、忘了 base_url，
// 请求会打到 api.openai.com 而不是他以为的那家。要修这个得把「没配」和
// 「配成默认值」区分开，那是一次独立的产品决定（§7.3.2 的 drift 提示
// 提到过这个需求），不在本次移植范围内。
const (
	defaultLLMBaseURL = "https://api.openai.com/v1"
	defaultLLMModel   = "gpt-4o-mini"
)

// Stored 是 `rehearse_settings` 里 `llm` 键的形状。
//
// 与墨言的 `LlmSettingsStored` 逐字段同名——两边共用一份表单，形状必须一致
// （§12 的风险表：「它的『形状』仍要同步」）。
type Stored struct {
	BaseURL     string  `json:"base_url"`
	APIKey      string  `json:"api_key"`
	Model       string  `json:"model"`
	Temperature float32 `json:"temperature"`
}

// Public 是 GET 的响应体（`LlmSettingsPublic`）。
//
// ⚠️ 它**没有** `api_key` 字段。密钥只以「有没有」和掩码形式出现，
// 明文永远不出库、不出接口（§13 的「凭据不泄漏」验收项）。
type Public struct {
	BaseURL      string  `json:"base_url"`
	Model        string  `json:"model"`
	Temperature  float32 `json:"temperature"`
	APIKeySet    bool    `json:"api_key_set"`
	APIKeyMasked *string `json:"api_key_masked"`
}

// UpdateRequest 是 PUT 的请求体。
//
// 全部字段可选（局部更新）：`nil` = 不改。`ClearAPIKey` 单独一个开关，
// 因为「把 key 清空」没法用 `api_key: ""` 表达——空串按 Rust 的语义是
// 「不改」（`admin_collect.rs:56-61`）。
type UpdateRequest struct {
	BaseURL     *string  `json:"base_url"`
	APIKey      *string  `json:"api_key"`
	Model       *string  `json:"model"`
	Temperature *float32 `json:"temperature"`
	ClearAPIKey bool     `json:"clear_api_key"`
}

// Service 是 LLM 配置服务。
type Service struct {
	store    store.Store
	fallback config.LLMFallback
}

// New 建一个 LLM 配置服务。`fallback` 来自环境变量（§7.7）。
func New(st store.Store, fallback config.LLMFallback) *Service {
	return &Service{store: st, fallback: fallback}
}

// Resolve 返回可直接用于 LLM 客户端的配置。
func (s *Service) Resolve(ctx context.Context) (llm.Settings, error) {
	stored, err := s.load(ctx)
	if err != nil {
		return llm.Settings{}, err
	}
	return llm.Settings{
		BaseURL:     stored.BaseURL,
		APIKey:      stored.APIKey,
		Model:       stored.Model,
		Temperature: stored.Temperature,
	}, nil
}

// Public 返回脱敏后的配置。
func (s *Service) Public(ctx context.Context) (Public, error) {
	stored, err := s.load(ctx)
	if err != nil {
		return Public{}, err
	}
	return toPublic(stored), nil
}

// Update 做一次局部更新并落库。
func (s *Service) Update(ctx context.Context, req UpdateRequest) (Public, error) {
	stored, err := s.load(ctx)
	if err != nil {
		return Public{}, err
	}

	if req.BaseURL != nil {
		// 去掉尾部斜杠：客户端会自己拼 `/chat/completions`，留着会拼出
		// `//chat/completions`。Rust 同样处理（`admin_collect.rs:46`）。
		stored.BaseURL = strings.TrimRight(strings.TrimSpace(*req.BaseURL), "/")
	}
	if req.Model != nil {
		stored.Model = strings.TrimSpace(*req.Model)
	}
	if req.Temperature != nil {
		stored.Temperature = clampTemperature(*req.Temperature)
	}
	if req.ClearAPIKey {
		stored.APIKey = ""
	} else if req.APIKey != nil {
		// 空串视为「不改」——表单每次都会回传掩码外的原值，
		// 把空串当成清空会让「只改 model」顺手把 key 抹掉。
		if trimmed := strings.TrimSpace(*req.APIKey); trimmed != "" {
			stored.APIKey = trimmed
		}
	}

	encoded, err := json.Marshal(stored)
	if err != nil {
		return Public{}, fmt.Errorf("marshal llm settings: %w", err)
	}
	if err := s.store.SettingPut(ctx, LLMKey, string(encoded)); err != nil {
		return Public{}, err
	}
	return toPublic(stored), nil
}

// defaultStored 是「从没配过」的起点。
//
// ⚠️ 它**必须**带上 temperature 默认值。用 `Stored{}` 的话 temperature 是 0，
// 而 0 是合法的贪心温度——「没配过」会静默变成「按 temperature=0 采样」，
// 与「配过但没写 temperature」得到 0.3 不一致。这个不一致没有任何报错，
// 只有对比两次请求的采样行为才看得出来。
func defaultStored() Stored {
	return Stored{Temperature: llm.DefaultTemperature}
}

// load 读库 + 补 env 兜底。
func (s *Service) load(ctx context.Context) (Stored, error) {
	raw, err := s.store.SettingGet(ctx, LLMKey)
	if err != nil {
		if err == store.ErrSettingNotFound {
			return fillFromEnvIfEmpty(defaultStored(), s.fallback), nil
		}
		return Stored{}, err
	}
	stored, err := decodeStored([]byte(raw))
	if err != nil {
		// 与 Rust 一致：坏 JSON 回退到「当作没配过」。
		//
		// 与 quota 的同类分支不同，这里不额外打日志——`fill_from_env_if_empty`
		// 会接手补上，而 env 兜底正是为这种情况准备的。
		return fillFromEnvIfEmpty(defaultStored(), s.fallback), nil
	}
	return fillFromEnvIfEmpty(stored, s.fallback), nil
}

// decodeStored 解析存储形状，并给**缺失的** temperature 补默认值。
//
// ⚠️ 与 `quota.Settings` 同一个坑：朴素解码会把缺失的 temperature 读成 0，
// 而 0 是合法的贪心温度——「少发一个字段」会静默改变模型的采样行为。
// 用指针区分「没给」与「给了 0」。
func decodeStored(raw []byte) (Stored, error) {
	var parsed struct {
		BaseURL     *string  `json:"base_url"`
		APIKey      *string  `json:"api_key"`
		Model       *string  `json:"model"`
		Temperature *float32 `json:"temperature"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return Stored{}, err
	}
	out := Stored{Temperature: llm.DefaultTemperature}
	if parsed.BaseURL != nil {
		out.BaseURL = *parsed.BaseURL
	}
	if parsed.APIKey != nil {
		out.APIKey = *parsed.APIKey
	}
	if parsed.Model != nil {
		out.Model = *parsed.Model
	}
	if parsed.Temperature != nil {
		out.Temperature = clampTemperature(*parsed.Temperature)
	}
	return out, nil
}

// fillFromEnvIfEmpty 是 Rust `fill_from_env_if_empty` 的直译。
//
// 只在**空**字段上补：DB 里有值就以 DB 为准（§7.3.2「权威来源是 DB」）。
func fillFromEnvIfEmpty(stored Stored, fallback config.LLMFallback) Stored {
	if strings.TrimSpace(stored.BaseURL) == "" {
		if value := strings.TrimSpace(fallback.BaseURL); value != "" {
			stored.BaseURL = value
		} else {
			stored.BaseURL = defaultLLMBaseURL
		}
	}
	if strings.TrimSpace(stored.APIKey) == "" {
		stored.APIKey = strings.TrimSpace(fallback.APIKey)
	}
	if strings.TrimSpace(stored.Model) == "" {
		if value := strings.TrimSpace(fallback.Model); value != "" {
			stored.Model = value
		} else {
			stored.Model = defaultLLMModel
		}
	}
	return stored
}

func toPublic(stored Stored) Public {
	return Public{
		BaseURL:      stored.BaseURL,
		Model:        stored.Model,
		Temperature:  stored.Temperature,
		APIKeySet:    strings.TrimSpace(stored.APIKey) != "",
		APIKeyMasked: MaskAPIKey(stored.APIKey),
	}
}

func clampTemperature(value float32) float32 {
	if value < llm.MinTemperature {
		return llm.MinTemperature
	}
	if value > llm.MaxTemperature {
		return llm.MaxTemperature
	}
	return value
}

// MaskAPIKey 把密钥压成可展示的形式（`models/admin_collect.rs:308-319`）。
//
//	""                  → nil（前端据此显示「未设置」）
//	"sk-abcd"（≤8 字节） → "***"
//	"sk-abcdefghijklmnop" → "sk-***mnop"
//
// ⚠️ 阈值按**字符数**算，不按字节数。Rust 用的是 `key.len()`（字节），但它的
// 前后缀是 `chars()` 切片——在 Go 里照抄字节阈值会 panic：一个 9 字节的
// 3 字符密钥过得了字节检查，却在 `runes[len-4:]` 上越界。API key 实际上都是
// ASCII，两种算法结果相同；差异只在非 ASCII 输入上，那时按字符算也更合理。
func MaskAPIKey(key string) *string {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return nil
	}
	runes := []rune(trimmed)
	if len(runes) <= 8 {
		masked := "***"
		return &masked
	}
	prefix := string(runes[:3])
	suffix := string(runes[len(runes)-4:])
	masked := prefix + "***" + suffix
	return &masked
}
