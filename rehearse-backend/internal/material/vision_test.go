package material

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/0x81/rehearse-backend/internal/llm"
	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/stretchr/testify/require"
)

// 本文件对齐 `interview_ocr.rs` 的 #[cfg(test)] 块，并补上服务层的顺序护栏：
// 「校验失败 / 未配置时不扣额度」和「上游错误体不下发」。
//
// 这里定义的 fakeQuota / fakeSettings / chatStub 是同包共享的测试脚手架，
// profile_test.go 复用它们。

type fakeQuota struct {
	calls int
	err   error
}

func (f *fakeQuota) CheckAndConsume(context.Context, string) error {
	f.calls++
	return f.err
}

type fakeSettings struct {
	settings llm.Settings
	err      error
}

func (f *fakeSettings) Resolve(context.Context) (llm.Settings, error) {
	return f.settings, f.err
}

// chatStub 是一个可脚本化的 OpenAI-compatible 端点：记录请求体、按需返回
// 成功 payload 或任意错误响应。
type chatStub struct {
	server   *httptest.Server
	status   int
	response string
	requests []map[string]any
}

func newChatStub(t *testing.T) *chatStub {
	t.Helper()
	stub := &chatStub{status: http.StatusOK}
	stub.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		stub.requests = append(stub.requests, body)
		w.WriteHeader(stub.status)
		_, _ = w.Write([]byte(stub.response))
	}))
	t.Cleanup(stub.server.Close)
	return stub
}

// configuredSettings 是三项都填好的配置。
func (s *chatStub) configuredSettings() llm.Settings {
	return llm.Settings{BaseURL: s.server.URL, APIKey: "sk-test", Model: "test-model"}
}

// completion 让端点返回一次正常的 chat completion，content 是模型输出的原文。
func (s *chatStub) completion(content string) {
	s.status = http.StatusOK
	payload, _ := json.Marshal(map[string]any{
		"choices": []any{map[string]any{"message": map[string]any{"content": content}}},
	})
	s.response = string(payload)
}

// failure 让端点返回指定的状态码与响应体。
func (s *chatStub) failure(status int, body string) {
	s.status = status
	s.response = body
}

func (s *chatStub) requestCount() int { return len(s.requests) }

func (s *chatStub) lastRequest(t *testing.T) map[string]any {
	t.Helper()
	require.NotEmpty(t, s.requests, "端点没有被调用")
	return s.requests[len(s.requests)-1]
}

func (s *chatStub) systemPrompt(t *testing.T) string {
	t.Helper()
	messages, _ := s.lastRequest(t)["messages"].([]any)
	require.NotEmpty(t, messages, "请求里没有 messages")
	first, _ := messages[0].(map[string]any)
	content, _ := first["content"].(string)
	return content
}

// userTextPart 取 user 消息里的文本段。带图片时 content 是数组，文本是第一段。
func (s *chatStub) userTextPart(t *testing.T) string {
	t.Helper()
	messages, _ := s.lastRequest(t)["messages"].([]any)
	require.GreaterOrEqual(t, len(messages), 2, "请求里没有 user 消息")
	second, _ := messages[1].(map[string]any)
	switch content := second["content"].(type) {
	case string:
		return content
	case []any:
		require.NotEmpty(t, content, "user content 数组为空")
		first, _ := content[0].(map[string]any)
		text, _ := first["text"].(string)
		return text
	default:
		require.Failf(t, "user content 类型不对", "user content 类型 = %T", second["content"])
		return ""
	}
}

func (s *chatStub) maxTokens(t *testing.T) int {
	t.Helper()
	value, ok := s.lastRequest(t)["max_tokens"].(float64)
	require.True(t, ok, "请求里没有 max_tokens")
	return int(value)
}

func validImages(count int) []llm.ImagePart {
	encoded := base64.StdEncoding.EncodeToString([]byte("fake-image-bytes"))
	out := make([]llm.ImagePart, 0, count)
	for range count {
		out = append(out, llm.ImagePart{MediaType: "image/jpeg", DataBase64: encoded})
	}
	return out
}

// requireAPIError 断言错误是 *middleware.APIError，且状态码 / reason 匹配。
func requireAPIError(t *testing.T, err error, status int, reason string) *middleware.APIError {
	t.Helper()
	var apiErr *middleware.APIError
	require.ErrorAsf(t, err, &apiErr, "错误类型 = %T，期望 *middleware.APIError（err=%v）", err, err)
	require.Equalf(t, status, apiErr.Status, "状态码（msg=%q）", apiErr.Message)
	require.Equal(t, reason, apiErr.Reason, "reason")
	return apiErr
}

func TestOCRReturnsTranscribedText(t *testing.T) {
	stub := newChatStub(t)
	stub.completion(`{"text":"Alice Chen\nBackend Engineer"}`)
	quota := &fakeQuota{}
	service := NewOCRService(quota, &fakeSettings{settings: stub.configuredSettings()}, llm.New())

	got, err := service.OCR(context.Background(), "user-1", validImages(1))
	require.NoError(t, err, "不该报错")
	require.Equal(t, "Alice Chen\nBackend Engineer", got, "OCR")
	require.Equal(t, 1, quota.calls, "额度消费次数")
	require.Equal(t, ocrSystemPrompt, stub.systemPrompt(t), "system prompt 与 Rust 不一致")
	require.Equal(t, "Transcribe the attached document images.", stub.userTextPart(t), "user 消息")
	require.Equal(t, maxOCRTokens, stub.maxTokens(t), "max_tokens")
}

// 图片校验必须发生在任何外部调用之前：非法图片不产生 LLM 请求、不扣额度。
func TestOCRValidatesImagesBeforeQuota(t *testing.T) {
	cases := []struct {
		name   string
		images []llm.ImagePart
	}{
		{"空列表", nil},
		{"超过 5 张", validImages(6)},
		{"非图片类型", []llm.ImagePart{{MediaType: "application/pdf", DataBase64: "AAA"}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stub := newChatStub(t)
			quota := &fakeQuota{}
			service := NewOCRService(quota, &fakeSettings{settings: stub.configuredSettings()}, llm.New())

			_, err := service.OCR(context.Background(), "user-1", tc.images)
			_ = requireAPIError(t, err, http.StatusBadRequest, "")
			require.Zero(t, quota.calls, "校验失败却扣了额度")
			require.Zero(t, stub.requestCount(), "校验失败却调了 LLM")
		})
	}
}

// 这是最关键的一条顺序护栏：未配置时**先** 503，绝不先扣额度。
func TestOCRDoesNotConsumeQuotaWhenUnconfigured(t *testing.T) {
	stub := newChatStub(t)
	quota := &fakeQuota{}
	// 只有 BaseURL、没有 API key → Configured() == false。
	service := NewOCRService(quota, &fakeSettings{settings: llm.Settings{BaseURL: stub.server.URL}}, llm.New())

	_, err := service.OCR(context.Background(), "user-1", validImages(1))
	apiErr := requireAPIError(t, err, http.StatusServiceUnavailable, "")
	require.Equal(t, msgAINotConfigured, apiErr.Message, "文案")
	require.Zero(t, quota.calls, "未配置却扣了额度")
}

// 对齐 Rust 的 `vision_unsupported_hint_matches_upstream_wording` 的服务层结果：
// 上游明确拒绝图片 → 422 vision_not_supported。
func TestOCRVisionUnsupportedIsUnprocessable(t *testing.T) {
	stub := newChatStub(t)
	stub.failure(http.StatusBadRequest, `{"error":{"message":"model does not support image input"}}`)
	quota := &fakeQuota{}
	service := NewOCRService(quota, &fakeSettings{settings: stub.configuredSettings()}, llm.New())

	_, err := service.OCR(context.Background(), "user-1", validImages(1))
	apiErr := requireAPIError(t, err, http.StatusUnprocessableEntity, "vision_not_supported")
	require.Equal(t, msgVisionNotSupported, apiErr.Message, "文案")
}

// 其余上游失败一律 503 固定文案——**上游错误体里的账号标识不下发**。
func TestOCROtherUpstreamFailureIs503AndDoesNotLeak(t *testing.T) {
	stub := newChatStub(t)
	stub.failure(http.StatusInternalServerError, `{"error":{"message":"boom for account sk-secret-12345"}}`)
	quota := &fakeQuota{}
	service := NewOCRService(quota, &fakeSettings{settings: stub.configuredSettings()}, llm.New())

	_, err := service.OCR(context.Background(), "user-1", validImages(1))
	apiErr := requireAPIError(t, err, http.StatusServiceUnavailable, "")
	require.Equal(t, msgOCRUnavailable, apiErr.Message, "文案 期望固定文案")
	require.NotContains(t, apiErr.Message, "sk-secret", "上游账号标识泄漏进了响应")
}

func TestOCRQuotaErrorPropagates(t *testing.T) {
	stub := newChatStub(t)
	stub.completion(`{"text":"unused"}`)
	quotaErr := middleware.QuotaExceeded(100, 100, "2026-10-04T00:00:00+08:00")
	quota := &fakeQuota{err: quotaErr}
	service := NewOCRService(quota, &fakeSettings{settings: stub.configuredSettings()}, llm.New())

	_, err := service.OCR(context.Background(), "user-1", validImages(1))
	apiErr := requireAPIError(t, err, http.StatusTooManyRequests, "rehearse_quota_exceeded")
	require.Equal(t, quotaErr.Message, apiErr.Message, "文案 期望原样透传配额错误")
	require.Zero(t, stub.requestCount(), "配额超限却仍调了 LLM")
}

func TestOCRSettingsResolveErrorIsRepository(t *testing.T) {
	quota := &fakeQuota{}
	service := NewOCRService(quota, &fakeSettings{err: errors.New("db down")}, llm.New())

	_, err := service.OCR(context.Background(), "user-1", validImages(1))
	_ = requireAPIError(t, err, http.StatusInternalServerError, "")
	require.Zero(t, quota.calls, "配置解析失败却扣了额度")
}

// 直接钉住判别逻辑：只有「图片语义 + 拒绝语义」同时出现才是 422。
func TestMapOCRUpstreamError(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantStatus int
		wantReason string
	}{
		{
			name:       "模型不支持图片",
			err:        &llm.ErrUpstream{StatusCode: 400, Detail: "model does not support image input"},
			wantStatus: http.StatusUnprocessableEntity,
			wantReason: "vision_not_supported",
		},
		{
			name:       "vision not supported",
			err:        &llm.ErrUpstream{StatusCode: 400, Detail: "invalid content type: vision not supported"},
			wantStatus: http.StatusUnprocessableEntity,
			wantReason: "vision_not_supported",
		},
		{
			// Rust 的负例一：限流，不含图片语义。
			name:       "限流",
			err:        &llm.ErrUpstream{StatusCode: 429, Detail: "rate limited"},
			wantStatus: http.StatusServiceUnavailable,
		},
		{
			// Rust 的负例二：密钥错误，只有拒绝语义、没有图片语义。
			name:       "密钥错误",
			err:        &llm.ErrUpstream{StatusCode: 400, Detail: "invalid api key"},
			wantStatus: http.StatusServiceUnavailable,
		},
		{
			name:       "非上游错误",
			err:        errors.New("something else"),
			wantStatus: http.StatusServiceUnavailable,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_ = requireAPIError(t, mapOCRUpstreamError(tc.err), tc.wantStatus, tc.wantReason)
		})
	}
}

func TestParseOCRPayload(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		want    string
		wantErr string
	}{
		{
			// 对齐 Rust 的 `parses_ocr_payload`（interview_ocr.rs:165）。
			name: "正常输出",
			raw:  `{"text":"Alice Chen\nBackend Engineer"}`,
			want: "Alice Chen\nBackend Engineer",
		},
		{
			name: "带 markdown 围栏",
			raw:  "```json\n{\"text\":\"hi\"}\n```",
			want: "hi",
		},
		{
			// 对齐 Rust 的 `rejects_empty_ocr_result`（interview_ocr.rs:174）。
			name:    "空文本",
			raw:     `{"text":"   "}`,
			wantErr: "OCR returned no text",
		},
		{
			name:    "非法 JSON",
			raw:     "not json at all",
			wantErr: "invalid OCR JSON",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseOCRPayload(tc.raw)
			if tc.wantErr != "" {
				require.Error(t, err, "应当报错")
				require.Contains(t, err.Error(), tc.wantErr, "错误信息")
				_ = requireAPIError(t, err, http.StatusBadRequest, "")
				return
			}
			require.NoError(t, err, "不该报错")
			require.Equal(t, tc.want, got, "解析结果")
		})
	}
}
