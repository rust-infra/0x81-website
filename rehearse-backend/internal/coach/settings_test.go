package coach

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/0x81/rehearse-backend/internal/config"
	"github.com/0x81/rehearse-backend/internal/llm"
	"github.com/0x81/rehearse-backend/internal/store/storetest"
	"github.com/stretchr/testify/require"
)

// 对齐 Rust 的 `masks_api_key`（`models/admin_collect.rs:326`）。
func TestMaskAPIKey(t *testing.T) {
	cases := []struct {
		key  string
		want *string
	}{
		{"", nil},
		{"   ", nil},
		{"sk-abcd", ptr("***")},
		{"sk-abcdefghijklmnop", ptr("sk-***mnop")},
	}
	for _, tc := range cases {
		got := maskAPIKey(tc.key)
		if tc.want == nil {
			require.Nilf(t, got, "maskAPIKey(%q) 期望 nil", tc.key)
			continue
		}
		require.NotNilf(t, got, "maskAPIKey(%q) 期望 %q", tc.key, *tc.want)
		require.Equalf(t, *tc.want, *got, "maskAPIKey(%q)", tc.key)
	}
}

// 非 ASCII 密钥不能把切片切越界——Rust 按字节判阈值、按字符切片，
// 照抄会在 Go 里 panic。
func TestMaskAPIKeyDoesNotPanicOnMultibyte(t *testing.T) {
	got := maskAPIKey("密钥密钥密钥") // 6 字符 / 18 字节
	require.NotNil(t, got, "不该返回 nil")
	require.Contains(t, *got, "***", "掩码")
}

func ptr(value string) *string { return &value }

// ⚠️ 缺失的 temperature 必须补 0.3，不能被读成 0（0 是合法的贪心温度）。
func TestDecodeStoredDefaultsTemperature(t *testing.T) {
	stored, err := decodeLLMStored([]byte(`{"base_url":"https://example.com/v1","model":"m"}`))
	require.NoError(t, err)
	require.Equal(t, llm.DefaultTemperature, stored.Temperature, "temperature")
}

// 显式给 0 要保留 0。
func TestDecodeStoredKeepsExplicitZeroTemperature(t *testing.T) {
	stored, err := decodeLLMStored([]byte(`{"temperature":0}`))
	require.NoError(t, err)
	require.Zero(t, stored.Temperature, "temperature")
}

func TestDecodeStoredClampsTemperature(t *testing.T) {
	stored, err := decodeLLMStored([]byte(`{"temperature":9}`))
	require.NoError(t, err)
	require.Equal(t, llm.MaxTemperature, stored.Temperature, "temperature")
}

// env 只在字段为空时补；DB 有值就以 DB 为准。
func TestFillFromEnvIfEmpty(t *testing.T) {
	fallback := config.LLMFallback{
		BaseURL: "https://env.example.com/v1",
		APIKey:  "env-key",
		Model:   "env-model",
	}

	filled := fillFromEnvIfEmpty(llmStored{}, fallback)
	require.Equal(t, fallback.BaseURL, filled.BaseURL, "空配置应当由 env 补上 base_url")
	require.Equal(t, fallback.APIKey, filled.APIKey, "空配置应当由 env 补上 api_key")
	require.Equal(t, fallback.Model, filled.Model, "空配置应当由 env 补上 model")

	fromDB := fillFromEnvIfEmpty(llmStored{
		BaseURL: "https://db.example.com/v1",
		APIKey:  "db-key",
		Model:   "db-model",
	}, fallback)
	require.Equal(t, "https://db.example.com/v1", fromDB.BaseURL, "DB 有值时 env 不该覆盖 base_url")
	require.Equal(t, "db-key", fromDB.APIKey, "DB 有值时 env 不该覆盖 api_key")
	require.Equal(t, "db-model", fromDB.Model, "DB 有值时 env 不该覆盖 model")
}

// env 也没有时落到硬默认值——这是从 Rust 继承的行为，写下来免得被当成 bug 改掉。
func TestFillFromEnvIfEmptyUsesBuiltInDefaults(t *testing.T) {
	filled := fillFromEnvIfEmpty(llmStored{}, config.LLMFallback{})
	require.Equal(t, defaultLLMBaseURL, filled.BaseURL, "base_url")
	require.Equal(t, defaultLLMModel, filled.Model, "model")
	// API key 没有默认值——「没配」必须仍然是 503。
	require.Empty(t, filled.APIKey, "api_key 期望空")
}

func TestResolveFallsBackToEnvWhenUnset(t *testing.T) {
	service := NewLLMSettingsService(storetest.New(), config.LLMFallback{
		BaseURL: "https://env.example.com/v1",
		APIKey:  "env-key",
		Model:   "env-model",
	})
	resolved, err := service.Resolve(context.Background())
	require.NoError(t, err)
	require.True(t, resolved.Configured(), "env 兜底后应当算已配置")
	require.Equal(t, llm.DefaultTemperature, resolved.Temperature, "temperature")
}

// 没配过时 Public 的 api_key_set 必须是 false，且掩码为 null。
func TestPublicReportsUnsetKey(t *testing.T) {
	service := NewLLMSettingsService(storetest.New(), config.LLMFallback{})
	public, err := service.Public(context.Background())
	require.NoError(t, err)
	require.False(t, public.APIKeySet, "没有 key 时 api_key_set 应当是 false")
	require.Nil(t, public.APIKeyMasked, "api_key_masked 期望 null")
}

// Public 的 JSON 里绝不能出现 api_key 明文（§13 的凭据不泄漏验收）。
func TestPublicJSONNeverContainsPlainKey(t *testing.T) {
	st := storetest.New()
	st.SetSetting(llmSettingKey, `{"base_url":"https://x/v1","api_key":"sk-supersecretvalue","model":"m"}`)
	service := NewLLMSettingsService(st, config.LLMFallback{})

	public, err := service.Public(context.Background())
	require.NoError(t, err)
	encoded, err := json.Marshal(public)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "sk-supersecretvalue", "响应体泄漏了明文密钥")
	require.True(t, public.APIKeySet, "api_key_set 应当是 true")
	require.NotNil(t, public.APIKeyMasked, "掩码")
	require.Equal(t, "sk-***alue", *public.APIKeyMasked, "掩码")
}

func TestUpdateTrimsBaseURLTrailingSlash(t *testing.T) {
	service := NewLLMSettingsService(storetest.New(), config.LLMFallback{})
	baseURL := "https://api.example.com/v1///"
	public, err := service.Update(context.Background(), LLMUpdateRequest{BaseURL: &baseURL})
	require.NoError(t, err)
	require.Equal(t, "https://api.example.com/v1", public.BaseURL, "base_url")
}

// 空字符串的 api_key 表示「不改」——表单每次都会回传，误判成清空会顺手抹掉密钥。
func TestUpdateEmptyAPIKeyDoesNotClear(t *testing.T) {
	st := storetest.New()
	st.SetSetting(llmSettingKey, `{"base_url":"https://x/v1","api_key":"sk-original-key","model":"m"}`)
	service := NewLLMSettingsService(st, config.LLMFallback{})

	empty := "  "
	public, err := service.Update(context.Background(), LLMUpdateRequest{APIKey: &empty})
	require.NoError(t, err)
	require.True(t, public.APIKeySet, "空串不该清掉密钥")
}

// 要清掉密钥必须显式 clear_api_key。
func TestUpdateClearAPIKeyFlag(t *testing.T) {
	st := storetest.New()
	st.SetSetting(llmSettingKey, `{"base_url":"https://x/v1","api_key":"sk-original-key","model":"m"}`)
	service := NewLLMSettingsService(st, config.LLMFallback{})

	public, err := service.Update(context.Background(), LLMUpdateRequest{ClearAPIKey: true})
	require.NoError(t, err)
	require.False(t, public.APIKeySet, "clear_api_key 之后 api_key_set 应当为 false")
	require.Nil(t, public.APIKeyMasked, "clear_api_key 之后掩码应当为 null")
}

// 局部更新：只改 model 不能动其他字段。
func TestUpdateIsPartial(t *testing.T) {
	st := storetest.New()
	st.SetSetting(llmSettingKey, `{"base_url":"https://x/v1","api_key":"sk-original-key","model":"old","temperature":0.7}`)
	service := NewLLMSettingsService(st, config.LLMFallback{})

	model := "new-model"
	public, err := service.Update(context.Background(), LLMUpdateRequest{Model: &model})
	require.NoError(t, err)
	require.Equal(t, "new-model", public.Model, "model")
	require.Equal(t, "https://x/v1", public.BaseURL, "base_url 被改动了")
	require.Equal(t, float32(0.7), public.Temperature, "temperature 被改动了")
	require.True(t, public.APIKeySet, "api_key 被清掉了")
}

// 写进去的值要能读回来（跨请求一致）。
func TestUpdateRoundTripThroughStore(t *testing.T) {
	service := NewLLMSettingsService(storetest.New(), config.LLMFallback{})
	baseURL := "https://api.deepseek.com/v1"
	model := "deepseek-flash"
	key := "sk-abcdefghijklmnop"
	temperature := float32(0.5)

	_, err := service.Update(context.Background(), LLMUpdateRequest{
		BaseURL: &baseURL, Model: &model, APIKey: &key, Temperature: &temperature,
	})
	require.NoError(t, err)

	resolved, err := service.Resolve(context.Background())
	require.NoError(t, err)
	require.Equal(t, baseURL, resolved.BaseURL, "读回 base_url")
	require.Equal(t, model, resolved.Model, "读回 model")
	require.Equal(t, key, resolved.APIKey, "读回 api_key")
	require.Equal(t, temperature, resolved.Temperature, "temperature")
}
