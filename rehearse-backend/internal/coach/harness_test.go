package coach

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/0x81/rehearse-backend/internal/config"
	"github.com/0x81/rehearse-backend/internal/llm"
	"github.com/0x81/rehearse-backend/internal/model"
	"github.com/0x81/rehearse-backend/internal/scenarios"
	"github.com/0x81/rehearse-backend/internal/store/storetest"
	"github.com/stretchr/testify/require"
)

// harness 把三件外部依赖都换成可控的假实现：LLM（httptest）、存储（内存）、
// 场景目录（真实的内嵌数据——它本来就是 go:embed 的常量）。
type harness struct {
	service *Service
	store   *storetest.Fake
	server  *httptest.Server

	// responses 是脚本化的模型输出，按调用顺序取；用完后重复最后一条。
	responses []string
	// requests 记录每次请求的请求体，供断言 prompt 内容。
	requests []map[string]any
	// calls 是 LLM 被调用的次数——「不该调 LLM」的用例靠它断言。
	calls int
	// failures 是前 N 次调用返回 500，用于验「重试一次」。
	failures int
}

func newHarness(t *testing.T, responses ...string) *harness {
	t.Helper()
	return newHarnessWithLLM(t, config.LLMFallback{}, responses...)
}

// newHarnessNoLLM 造一个「LLM 没配」的 harness：没有 API key 时
// `ensure_configured` 会失败，用于验 503 与「不扣额度」。
func newHarnessNoLLM(t *testing.T) *harness {
	t.Helper()
	return newHarnessWithLLM(t, config.LLMFallback{BaseURL: "https://example.invalid/v1"})
}

func newHarnessWithLLM(t *testing.T, override config.LLMFallback, responses ...string) *harness {
	t.Helper()
	h := &harness{store: storetest.New(), responses: responses}
	h.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		h.requests = append(h.requests, body)
		h.calls++

		if h.calls <= h.failures {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"error":"upstream exploded"}`))
			return
		}

		content := ""
		if len(h.responses) > 0 {
			index := h.calls - 1
			if index >= len(h.responses) {
				index = len(h.responses) - 1
			}
			content = h.responses[index]
		}
		payload, _ := json.Marshal(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"content": content}}},
		})
		_, _ = w.Write(payload)
	}))
	t.Cleanup(h.server.Close)

	catalog, err := scenarios.Load()
	require.NoError(t, err, "load scenario catalog")
	fallback := config.LLMFallback{
		BaseURL: h.server.URL,
		APIKey:  "sk-test",
		Model:   "test-model",
	}
	if override.BaseURL != "" || override.APIKey != "" || override.Model != "" {
		fallback = override
	}
	llmSettings := NewLLMSettingsService(h.store, fallback)
	h.service = NewService(NewQuotaService(h.store), llmSettings, catalog, llm.New())
	return h
}

// setQuota 直接写配额设置。
func (h *harness) setQuota(t *testing.T, limit uint32, enabled bool) {
	t.Helper()
	encoded, err := json.Marshal(QuotaSettings{DailyTurnLimit: limit, Enabled: enabled})
	require.NoError(t, err)
	h.store.SetSetting(quotaSettingKey, string(encoded))
}

// systemPrompt 返回第 index 次 LLM 调用的 system prompt。
func (h *harness) systemPrompt(t *testing.T, index int) string {
	t.Helper()
	require.Lessf(t, index, len(h.requests), "只有 %d 次 LLM 调用，取不到第 %d 次", len(h.requests), index)
	messages, _ := h.requests[index]["messages"].([]any)
	require.NotEmpty(t, messages, "请求里没有 messages")
	first, _ := messages[0].(map[string]any)
	content, _ := first["content"].(string)
	return content
}

// userMessage 返回第 index 次 LLM 调用的 user message。
func (h *harness) userMessage(t *testing.T, index int) string {
	t.Helper()
	messages, _ := h.requests[index]["messages"].([]any)
	require.GreaterOrEqual(t, len(messages), 2, "请求里没有 user 消息")
	second, _ := messages[1].(map[string]any)
	content, _ := second["content"].(string)
	return content
}

// fixtureScenario 是一个最小的合法场景。
func fixtureScenario() model.Scenario {
	return model.Scenario{
		ID:          "standup_update",
		Source:      model.SourceCustom,
		Category:    model.CategoryDaily,
		Language:    model.LanguageEnUS,
		Title:       "每日站会",
		Description: "汇报进度",
		Persona: model.Persona{
			Name: "Alex", Role: "Tech Lead", Tone: "friendly",
		},
		Setting:     "meeting",
		OpeningLine: "Morning! How's the feature going?",
		FocusPoints: []string{"progress"},
		Difficulty:  "core",
		MaxTurns:    10,
	}
}

func fixtureTurnRequest() model.TurnRequest {
	return model.TurnRequest{
		Scenario: fixtureScenario(),
		History:  []model.Turn{},
		UserText: "I'm on the API.",
		Mode:     model.ModeFeedback,
	}
}

// validTurnPayload 是一份完整的模型输出，字段名是 §7.6 的新契约。
const validTurnPayload = `{"reply":"Nice! Any blockers?","reply_translation":"不错！有卡住的地方吗？",` +
	`"mood":"curious","feedback":{"corrections":[{"original":"We finish it",` +
	`"corrected":"We finished it","explanation_zh":"用过去式"}],` +
	`"better_phrasing":{"original":"today do UI","natural":"I'm on the UI today","note_zh":"更自然"},` +
	`"expressions":[{"text":"I'm on it.","translation":"我在做。"}]},` +
	`"next_lines":[{"text":"I'll pick up the next ticket.","translation":"我来接下一个工单。"},` +
	`{"text":"Give me an hour.","translation":"给我一小时。"}]}`

func ctx() context.Context { return context.Background() }

// now 是测试里的「现在」，用于断言当天的用量落在正确的日键上。
func now() time.Time { return time.Now() }
