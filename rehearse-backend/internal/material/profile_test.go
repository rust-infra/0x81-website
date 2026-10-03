package material

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/0x81/rehearse-backend/internal/llm"
	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/0x81/rehearse-backend/internal/model"
	"github.com/stretchr/testify/require"
)

// 本文件对齐 `interview_profile.rs` 的 #[cfg(test)] 块，并复用 vision_test.go
// 里的 fakeQuota / fakeSettings / chatStub。

func profileRequest(kind, text string) model.MaterialProfileRequest {
	return model.MaterialProfileRequest{Kind: kind, Text: text}
}

// 对齐 Rust 的 `validates_kind_and_length`（interview_profile.rs:145），
// 并补上「正好到上限」的边界。
func TestValidateProfileRequest(t *testing.T) {
	cases := []struct {
		name    string
		req     model.MaterialProfileRequest
		wantErr string
	}{
		{"resume 合法", profileRequest("resume", "x"), ""},
		{"job 合法", profileRequest("job", "x"), ""},
		{"未知 kind", profileRequest("cv", "x"), "kind must be resume or job"},
		{"空文本", profileRequest("resume", "   "), "text is required"},
		{"正好到上限", profileRequest("resume", strings.Repeat("字", MaxTextChars)), ""},
		{"超过上限", profileRequest("resume", strings.Repeat("字", MaxTextChars+1)), "text must be at most 20000 characters"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateProfileRequest(tc.req)
			if tc.wantErr == "" {
				require.NoError(t, err, "不该报错")
				return
			}
			require.Error(t, err, "应当报错")
			require.Contains(t, err.Error(), tc.wantErr, "错误信息")
			_ = requireAPIError(t, err, http.StatusBadRequest, "")
		})
	}
}

func TestParseProfilePayload(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		want    string
		wantErr string
	}{
		{
			// 对齐 Rust 的 `parses_profile_payload`（interview_profile.rs:124）。
			name: "正常输出",
			raw:  `{"profile":"5 年后端，主导过支付网关"}`,
			want: "5 年后端，主导过支付网关",
		},
		{
			// 对齐 Rust 的 `strips_markdown_fences`（interview_profile.rs:133）。
			name: "带 markdown 围栏",
			raw:  "```json\n{\"profile\":\"ok\"}\n```",
			want: "ok",
		},
		{
			// 对齐 Rust 的 `rejects_empty_profile`（interview_profile.rs:139）。
			name:    "空档案",
			raw:     `{"profile":"  "}`,
			wantErr: "profile was empty",
		},
		{
			name:    "非法 JSON",
			raw:     "garbage",
			wantErr: "invalid profile JSON",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseProfilePayload(tc.raw)
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

func TestProfileReturnsParsedProfile(t *testing.T) {
	stub := newChatStub(t)
	stub.completion(`{"profile":"5 年后端，主导过支付网关"}`)
	quota := &fakeQuota{}
	service := NewProfileService(quota, &fakeSettings{settings: stub.configuredSettings()}, llm.New())

	got, err := service.Profile(context.Background(), "user-1", profileRequest("resume", "  我的简历  "))
	require.NoError(t, err, "不该报错")
	require.Equal(t, "resume", got.Kind, "响应 kind")
	require.Equal(t, "5 年后端，主导过支付网关", got.Profile, "响应 profile")
	require.Equal(t, 1, quota.calls, "额度消费次数")
	require.Equal(t, resumePrompt, stub.systemPrompt(t), "resume 请求的 system prompt")
	// user 消息是 trim 过的原文（Rust 传 req.text.trim()）。
	require.Equal(t, "我的简历", stub.userTextPart(t), "user 消息 期望 trim 后的原文")
	require.Equal(t, MaxProfileTokens, stub.maxTokens(t), "max_tokens")
}

func TestProfileUsesJobPrompt(t *testing.T) {
	stub := newChatStub(t)
	stub.completion(`{"profile":"ok"}`)
	service := NewProfileService(&fakeQuota{}, &fakeSettings{settings: stub.configuredSettings()}, llm.New())

	_, err := service.Profile(context.Background(), "user-1", profileRequest("job", "JD 正文"))
	require.NoError(t, err, "不该报错")
	require.Equal(t, jobPrompt, stub.systemPrompt(t), "job 请求的 system prompt")
}

// 校验失败发生在任何外部调用之前：不扣额度、不调 LLM。
func TestProfileDoesNotConsumeQuotaWhenValidationFails(t *testing.T) {
	cases := []struct {
		name string
		req  model.MaterialProfileRequest
	}{
		{"未知 kind", profileRequest("cv", "x")},
		{"空文本", profileRequest("resume", "   ")},
		{"文本超长", profileRequest("resume", strings.Repeat("字", MaxTextChars+1))},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stub := newChatStub(t)
			quota := &fakeQuota{}
			service := NewProfileService(quota, &fakeSettings{settings: stub.configuredSettings()}, llm.New())

			_, err := service.Profile(context.Background(), "user-1", tc.req)
			_ = requireAPIError(t, err, http.StatusBadRequest, "")
			require.Zero(t, quota.calls, "校验失败却扣了额度")
			require.Zero(t, stub.requestCount(), "校验失败却调了 LLM")
		})
	}
}

func TestProfileDoesNotConsumeQuotaWhenUnconfigured(t *testing.T) {
	stub := newChatStub(t)
	quota := &fakeQuota{}
	service := NewProfileService(quota, &fakeSettings{settings: llm.Settings{BaseURL: stub.server.URL}}, llm.New())

	_, err := service.Profile(context.Background(), "user-1", profileRequest("resume", "x"))
	apiErr := requireAPIError(t, err, http.StatusServiceUnavailable, "")
	require.Equal(t, msgAINotConfigured, apiErr.Message, "文案")
	require.Zero(t, quota.calls, "未配置却扣了额度")
}

func TestProfileUpstreamFailureIs503AndDoesNotLeak(t *testing.T) {
	stub := newChatStub(t)
	stub.failure(http.StatusInternalServerError, `{"error":{"message":"boom for account sk-secret-12345"}}`)
	quota := &fakeQuota{}
	service := NewProfileService(quota, &fakeSettings{settings: stub.configuredSettings()}, llm.New())

	_, err := service.Profile(context.Background(), "user-1", profileRequest("resume", "x"))
	apiErr := requireAPIError(t, err, http.StatusServiceUnavailable, "")
	require.Equal(t, msgProfileUnavailable, apiErr.Message, "文案 期望固定文案")
	require.NotContains(t, apiErr.Message, "sk-secret", "上游账号标识泄漏进了响应")
}

func TestProfileQuotaErrorPropagates(t *testing.T) {
	stub := newChatStub(t)
	stub.completion(`{"profile":"unused"}`)
	quotaErr := middleware.QuotaExceeded(100, 100, "2026-10-04T00:00:00+08:00")
	quota := &fakeQuota{err: quotaErr}
	service := NewProfileService(quota, &fakeSettings{settings: stub.configuredSettings()}, llm.New())

	_, err := service.Profile(context.Background(), "user-1", profileRequest("resume", "x"))
	apiErr := requireAPIError(t, err, http.StatusTooManyRequests, "rehearse_quota_exceeded")
	require.Equal(t, quotaErr.Message, apiErr.Message, "文案 期望原样透传配额错误")
	require.Zero(t, stub.requestCount(), "配额超限却仍调了 LLM")
}

// 模型吐出的不是约定 JSON 时，返回 400（不是服务故障）。
func TestProfileInvalidPayloadIs400(t *testing.T) {
	stub := newChatStub(t)
	stub.completion("this is not json")
	service := NewProfileService(&fakeQuota{}, &fakeSettings{settings: stub.configuredSettings()}, llm.New())

	_, err := service.Profile(context.Background(), "user-1", profileRequest("resume", "x"))
	require.Error(t, err, "应当报错")
	require.Contains(t, err.Error(), "invalid profile JSON", "错误信息")
	_ = requireAPIError(t, err, http.StatusBadRequest, "")
}

func TestProfileSettingsResolveErrorIsRepository(t *testing.T) {
	quota := &fakeQuota{}
	service := NewProfileService(quota, &fakeSettings{err: errors.New("db down")}, llm.New())

	_, err := service.Profile(context.Background(), "user-1", profileRequest("resume", "x"))
	_ = requireAPIError(t, err, http.StatusInternalServerError, "")
	require.Zero(t, quota.calls, "配置解析失败却扣了额度")
}
