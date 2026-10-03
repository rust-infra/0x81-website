package settings

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/0x81/rehearse-backend/internal/config"
	"github.com/0x81/rehearse-backend/internal/llm"
	"github.com/0x81/rehearse-backend/internal/store/storetest"
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
		got := MaskAPIKey(tc.key)
		switch {
		case tc.want == nil && got != nil:
			t.Fatalf("MaskAPIKey(%q) = %q，期望 nil", tc.key, *got)
		case tc.want != nil && got == nil:
			t.Fatalf("MaskAPIKey(%q) = nil，期望 %q", tc.key, *tc.want)
		case tc.want != nil && *got != *tc.want:
			t.Fatalf("MaskAPIKey(%q) = %q，期望 %q", tc.key, *got, *tc.want)
		}
	}
}

// 非 ASCII 密钥不能把切片切越界——Rust 按字节判阈值、按字符切片，
// 照抄会在 Go 里 panic。
func TestMaskAPIKeyDoesNotPanicOnMultibyte(t *testing.T) {
	got := MaskAPIKey("密钥密钥密钥") // 6 字符 / 18 字节
	if got == nil {
		t.Fatal("不该返回 nil")
	}
	if !strings.Contains(*got, "***") {
		t.Fatalf("掩码 = %q", *got)
	}
}

func ptr(value string) *string { return &value }

// ⚠️ 缺失的 temperature 必须补 0.3，不能被读成 0（0 是合法的贪心温度）。
func TestDecodeStoredDefaultsTemperature(t *testing.T) {
	stored, err := decodeStored([]byte(`{"base_url":"https://example.com/v1","model":"m"}`))
	if err != nil {
		t.Fatal(err)
	}
	if stored.Temperature != llm.DefaultTemperature {
		t.Fatalf("temperature = %v，期望 %v", stored.Temperature, llm.DefaultTemperature)
	}
}

// 显式给 0 要保留 0。
func TestDecodeStoredKeepsExplicitZeroTemperature(t *testing.T) {
	stored, err := decodeStored([]byte(`{"temperature":0}`))
	if err != nil {
		t.Fatal(err)
	}
	if stored.Temperature != 0 {
		t.Fatalf("temperature = %v，期望 0", stored.Temperature)
	}
}

func TestDecodeStoredClampsTemperature(t *testing.T) {
	stored, err := decodeStored([]byte(`{"temperature":9}`))
	if err != nil {
		t.Fatal(err)
	}
	if stored.Temperature != llm.MaxTemperature {
		t.Fatalf("temperature = %v，期望 %v", stored.Temperature, llm.MaxTemperature)
	}
}

// env 只在字段为空时补；DB 有值就以 DB 为准。
func TestFillFromEnvIfEmpty(t *testing.T) {
	fallback := config.LLMFallback{
		BaseURL: "https://env.example.com/v1",
		APIKey:  "env-key",
		Model:   "env-model",
	}

	filled := fillFromEnvIfEmpty(Stored{}, fallback)
	if filled.BaseURL != fallback.BaseURL || filled.APIKey != fallback.APIKey || filled.Model != fallback.Model {
		t.Fatalf("空配置应当全部由 env 补上，得到 %+v", filled)
	}

	fromDB := fillFromEnvIfEmpty(Stored{
		BaseURL: "https://db.example.com/v1",
		APIKey:  "db-key",
		Model:   "db-model",
	}, fallback)
	if fromDB.BaseURL != "https://db.example.com/v1" || fromDB.APIKey != "db-key" || fromDB.Model != "db-model" {
		t.Fatalf("DB 有值时 env 不该覆盖，得到 %+v", fromDB)
	}
}

// env 也没有时落到硬默认值——这是从 Rust 继承的行为，写下来免得被当成 bug 改掉。
func TestFillFromEnvIfEmptyUsesBuiltInDefaults(t *testing.T) {
	filled := fillFromEnvIfEmpty(Stored{}, config.LLMFallback{})
	if filled.BaseURL != defaultLLMBaseURL {
		t.Fatalf("base_url = %q，期望 %q", filled.BaseURL, defaultLLMBaseURL)
	}
	if filled.Model != defaultLLMModel {
		t.Fatalf("model = %q，期望 %q", filled.Model, defaultLLMModel)
	}
	// API key 没有默认值——「没配」必须仍然是 503。
	if filled.APIKey != "" {
		t.Fatalf("api_key = %q，期望空", filled.APIKey)
	}
}

func TestResolveFallsBackToEnvWhenUnset(t *testing.T) {
	service := New(storetest.New(), config.LLMFallback{
		BaseURL: "https://env.example.com/v1",
		APIKey:  "env-key",
		Model:   "env-model",
	})
	resolved, err := service.Resolve(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !resolved.Configured() {
		t.Fatalf("env 兜底后应当算已配置：%+v", resolved)
	}
	if resolved.Temperature != llm.DefaultTemperature {
		t.Fatalf("temperature = %v", resolved.Temperature)
	}
}

// 没配过时 Public 的 api_key_set 必须是 false，且掩码为 null。
func TestPublicReportsUnsetKey(t *testing.T) {
	service := New(storetest.New(), config.LLMFallback{})
	public, err := service.Public(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if public.APIKeySet {
		t.Fatal("没有 key 时 api_key_set 应当是 false")
	}
	if public.APIKeyMasked != nil {
		t.Fatalf("api_key_masked = %q，期望 null", *public.APIKeyMasked)
	}
}

// Public 的 JSON 里绝不能出现 api_key 明文（§13 的凭据不泄漏验收）。
func TestPublicJSONNeverContainsPlainKey(t *testing.T) {
	st := storetest.New()
	st.SetSetting(LLMKey, `{"base_url":"https://x/v1","api_key":"sk-supersecretvalue","model":"m"}`)
	service := New(st, config.LLMFallback{})

	public, err := service.Public(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(public)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "sk-supersecretvalue") {
		t.Fatalf("响应体泄漏了明文密钥：%s", encoded)
	}
	if !public.APIKeySet {
		t.Fatal("api_key_set 应当是 true")
	}
	if public.APIKeyMasked == nil || *public.APIKeyMasked != "sk-***alue" {
		t.Fatalf("掩码 = %v", public.APIKeyMasked)
	}
}

func TestUpdateTrimsBaseURLTrailingSlash(t *testing.T) {
	service := New(storetest.New(), config.LLMFallback{})
	baseURL := "https://api.example.com/v1///"
	public, err := service.Update(context.Background(), UpdateRequest{BaseURL: &baseURL})
	if err != nil {
		t.Fatal(err)
	}
	if public.BaseURL != "https://api.example.com/v1" {
		t.Fatalf("base_url = %q", public.BaseURL)
	}
}

// 空字符串的 api_key 表示「不改」——表单每次都会回传，误判成清空会顺手抹掉密钥。
func TestUpdateEmptyAPIKeyDoesNotClear(t *testing.T) {
	st := storetest.New()
	st.SetSetting(LLMKey, `{"base_url":"https://x/v1","api_key":"sk-original-key","model":"m"}`)
	service := New(st, config.LLMFallback{})

	empty := "  "
	public, err := service.Update(context.Background(), UpdateRequest{APIKey: &empty})
	if err != nil {
		t.Fatal(err)
	}
	if !public.APIKeySet {
		t.Fatal("空串不该清掉密钥")
	}
}

// 要清掉密钥必须显式 clear_api_key。
func TestUpdateClearAPIKeyFlag(t *testing.T) {
	st := storetest.New()
	st.SetSetting(LLMKey, `{"base_url":"https://x/v1","api_key":"sk-original-key","model":"m"}`)
	service := New(st, config.LLMFallback{})

	public, err := service.Update(context.Background(), UpdateRequest{ClearAPIKey: true})
	if err != nil {
		t.Fatal(err)
	}
	if public.APIKeySet || public.APIKeyMasked != nil {
		t.Fatalf("clear_api_key 之后应当没有密钥：%+v", public)
	}
}

// 局部更新：只改 model 不能动其他字段。
func TestUpdateIsPartial(t *testing.T) {
	st := storetest.New()
	st.SetSetting(LLMKey, `{"base_url":"https://x/v1","api_key":"sk-original-key","model":"old","temperature":0.7}`)
	service := New(st, config.LLMFallback{})

	model := "new-model"
	public, err := service.Update(context.Background(), UpdateRequest{Model: &model})
	if err != nil {
		t.Fatal(err)
	}
	if public.Model != "new-model" {
		t.Fatalf("model = %q", public.Model)
	}
	if public.BaseURL != "https://x/v1" {
		t.Fatalf("base_url 被改动了：%q", public.BaseURL)
	}
	if public.Temperature != 0.7 {
		t.Fatalf("temperature 被改动了：%v", public.Temperature)
	}
	if !public.APIKeySet {
		t.Fatal("api_key 被清掉了")
	}
}

// 写进去的值要能读回来（跨请求一致）。
func TestUpdateRoundTripThroughStore(t *testing.T) {
	service := New(storetest.New(), config.LLMFallback{})
	baseURL := "https://api.deepseek.com/v1"
	model := "deepseek-flash"
	key := "sk-abcdefghijklmnop"
	temperature := float32(0.5)

	if _, err := service.Update(context.Background(), UpdateRequest{
		BaseURL: &baseURL, Model: &model, APIKey: &key, Temperature: &temperature,
	}); err != nil {
		t.Fatal(err)
	}

	resolved, err := service.Resolve(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if resolved.BaseURL != baseURL || resolved.Model != model || resolved.APIKey != key {
		t.Fatalf("读回 = %+v", resolved)
	}
	if resolved.Temperature != temperature {
		t.Fatalf("temperature = %v，期望 %v", resolved.Temperature, temperature)
	}
}
