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
				if err != nil {
					t.Fatalf("不该报错：%v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("错误 = %v，期望含 %q", err, tc.wantErr)
			}
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
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("错误 = %v，期望含 %q", err, tc.wantErr)
				}
				_ = requireAPIError(t, err, http.StatusBadRequest, "")
				return
			}
			if err != nil {
				t.Fatalf("不该报错：%v", err)
			}
			if got != tc.want {
				t.Fatalf("解析 = %q，期望 %q", got, tc.want)
			}
		})
	}
}

func TestProfileReturnsParsedProfile(t *testing.T) {
	stub := newChatStub(t)
	stub.completion(`{"profile":"5 年后端，主导过支付网关"}`)
	quota := &fakeQuota{}
	service := NewProfileService(quota, &fakeSettings{settings: stub.configuredSettings()}, llm.New())

	got, err := service.Profile(context.Background(), "user-1", profileRequest("resume", "  我的简历  "))
	if err != nil {
		t.Fatalf("不该报错：%v", err)
	}
	if got.Kind != "resume" || got.Profile != "5 年后端，主导过支付网关" {
		t.Fatalf("响应 = %+v", got)
	}
	if quota.calls != 1 {
		t.Fatalf("额度消费次数 = %d，期望 1", quota.calls)
	}
	if system := stub.systemPrompt(t); system != resumePrompt {
		t.Fatalf("resume 请求用了错的 system prompt：\n%q", system)
	}
	// user 消息是 trim 过的原文（Rust 传 req.text.trim()）。
	if user := stub.userTextPart(t); user != "我的简历" {
		t.Fatalf("user 消息 = %q，期望 trim 后的原文", user)
	}
	if tokens := stub.maxTokens(t); tokens != MaxProfileTokens {
		t.Fatalf("max_tokens = %d，期望 %d", tokens, MaxProfileTokens)
	}
}

func TestProfileUsesJobPrompt(t *testing.T) {
	stub := newChatStub(t)
	stub.completion(`{"profile":"ok"}`)
	service := NewProfileService(&fakeQuota{}, &fakeSettings{settings: stub.configuredSettings()}, llm.New())

	if _, err := service.Profile(context.Background(), "user-1", profileRequest("job", "JD 正文")); err != nil {
		t.Fatalf("不该报错：%v", err)
	}
	if system := stub.systemPrompt(t); system != jobPrompt {
		t.Fatalf("job 请求用了错的 system prompt：\n%q", system)
	}
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
			if quota.calls != 0 {
				t.Fatalf("校验失败却扣了 %d 次额度", quota.calls)
			}
			if stub.requestCount() != 0 {
				t.Fatal("校验失败却调了 LLM")
			}
		})
	}
}

func TestProfileDoesNotConsumeQuotaWhenUnconfigured(t *testing.T) {
	stub := newChatStub(t)
	quota := &fakeQuota{}
	service := NewProfileService(quota, &fakeSettings{settings: llm.Settings{BaseURL: stub.server.URL}}, llm.New())

	_, err := service.Profile(context.Background(), "user-1", profileRequest("resume", "x"))
	apiErr := requireAPIError(t, err, http.StatusServiceUnavailable, "")
	if apiErr.Message != msgAINotConfigured {
		t.Fatalf("文案 = %q，期望 %q", apiErr.Message, msgAINotConfigured)
	}
	if quota.calls != 0 {
		t.Fatalf("未配置却扣了 %d 次额度", quota.calls)
	}
}

func TestProfileUpstreamFailureIs503AndDoesNotLeak(t *testing.T) {
	stub := newChatStub(t)
	stub.failure(http.StatusInternalServerError, `{"error":{"message":"boom for account sk-secret-12345"}}`)
	quota := &fakeQuota{}
	service := NewProfileService(quota, &fakeSettings{settings: stub.configuredSettings()}, llm.New())

	_, err := service.Profile(context.Background(), "user-1", profileRequest("resume", "x"))
	apiErr := requireAPIError(t, err, http.StatusServiceUnavailable, "")
	if apiErr.Message != msgProfileUnavailable {
		t.Fatalf("文案 = %q，期望固定文案", apiErr.Message)
	}
	if strings.Contains(apiErr.Message, "sk-secret") {
		t.Fatalf("上游账号标识泄漏进了响应：%q", apiErr.Message)
	}
}

func TestProfileQuotaErrorPropagates(t *testing.T) {
	stub := newChatStub(t)
	stub.completion(`{"profile":"unused"}`)
	quotaErr := middleware.QuotaExceeded(100, 100, "2026-10-04T00:00:00+08:00")
	quota := &fakeQuota{err: quotaErr}
	service := NewProfileService(quota, &fakeSettings{settings: stub.configuredSettings()}, llm.New())

	_, err := service.Profile(context.Background(), "user-1", profileRequest("resume", "x"))
	apiErr := requireAPIError(t, err, http.StatusTooManyRequests, "rehearse_quota_exceeded")
	if apiErr.Message != quotaErr.Message {
		t.Fatalf("文案 = %q，期望原样透传配额错误", apiErr.Message)
	}
	if stub.requestCount() != 0 {
		t.Fatal("配额超限却仍调了 LLM")
	}
}

// 模型吐出的不是约定 JSON 时，返回 400（不是服务故障）。
func TestProfileInvalidPayloadIs400(t *testing.T) {
	stub := newChatStub(t)
	stub.completion("this is not json")
	service := NewProfileService(&fakeQuota{}, &fakeSettings{settings: stub.configuredSettings()}, llm.New())

	_, err := service.Profile(context.Background(), "user-1", profileRequest("resume", "x"))
	if err == nil || !strings.Contains(err.Error(), "invalid profile JSON") {
		t.Fatalf("错误 = %v，期望 invalid profile JSON", err)
	}
	_ = requireAPIError(t, err, http.StatusBadRequest, "")
}

func TestProfileSettingsResolveErrorIsRepository(t *testing.T) {
	quota := &fakeQuota{}
	service := NewProfileService(quota, &fakeSettings{err: errors.New("db down")}, llm.New())

	_, err := service.Profile(context.Background(), "user-1", profileRequest("resume", "x"))
	_ = requireAPIError(t, err, http.StatusInternalServerError, "")
	if quota.calls != 0 {
		t.Fatalf("配置解析失败却扣了 %d 次额度", quota.calls)
	}
}
