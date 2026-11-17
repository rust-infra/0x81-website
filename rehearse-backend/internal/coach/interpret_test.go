package coach

import (
	"context"
	"testing"

	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/0x81/rehearse-backend/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTranslateHappyPath(t *testing.T) {
	h := newHarness(t, `{"translation":"能否按 FOB 上海条款给个更好的价格？"}`)

	out, err := h.service.Translate(context.Background(), "user-1", model.TranslateRequest{
		Text: "Could you offer a better price on FOB Shanghai terms?",
	})
	require.NoError(t, err)
	assert.Equal(t, "能否按 FOB 上海条款给个更好的价格？", out.Translation)
	assert.Equal(t, 1, h.calls, "应当调用一次 LLM")

	system := h.systemPrompt(t, 0)
	assert.Contains(t, system, "simultaneous interpreter", "system prompt 应当标明同传角色")
	assert.Contains(t, system, "Incoterm", "system prompt 应当要求保留贸易术语")
	assert.Equal(t, "Could you offer a better price on FOB Shanghai terms?", h.userMessage(t, 0))
}

func TestTranslateStripsCodeFences(t *testing.T) {
	h := newHarness(t, "```json\n{\"translation\":\"交期四十五天。\"}\n```")

	out, err := h.service.Translate(context.Background(), "user-1", model.TranslateRequest{
		Text: "The lead time is forty five days.",
	})
	require.NoError(t, err)
	assert.Equal(t, "交期四十五天。", out.Translation)
}

func TestTranslateRejectsEmptyText(t *testing.T) {
	h := newHarness(t, `{"translation":"x"}`)

	_, err := h.service.Translate(context.Background(), "user-1", model.TranslateRequest{Text: "   "})
	require.Error(t, err)
	apiErr, ok := err.(*middleware.APIError)
	require.True(t, ok, "应当是 APIError")
	assert.Equal(t, 400, apiErr.Status)
	assert.Equal(t, 0, h.calls, "非法输入不该产生 LLM 请求")
}

func TestTranslateRejectsOverlongText(t *testing.T) {
	h := newHarness(t, `{"translation":"x"}`)
	long := make([]rune, maxTranslateChars+1)
	for i := range long {
		long[i] = 'a'
	}

	_, err := h.service.Translate(context.Background(), "user-1", model.TranslateRequest{Text: string(long)})
	require.Error(t, err)
	apiErr, ok := err.(*middleware.APIError)
	require.True(t, ok)
	assert.Equal(t, 400, apiErr.Status)
	assert.Equal(t, 0, h.calls)
}

func TestTranslateUnavailableWhenNotConfigured(t *testing.T) {
	h := newHarnessNoLLM(t)

	_, err := h.service.Translate(context.Background(), "user-1", model.TranslateRequest{
		Text: "Hello.",
	})
	require.Error(t, err)
	apiErr, ok := err.(*middleware.APIError)
	require.True(t, ok)
	assert.Equal(t, 503, apiErr.Status)
	assert.Equal(t, MsgAINotConfigured, apiErr.Message)
	assert.Equal(t, 0, h.calls)
}

func TestTranslateMalformedOutputIsUnavailable(t *testing.T) {
	h := newHarness(t, "not json at all")

	_, err := h.service.Translate(context.Background(), "user-1", model.TranslateRequest{
		Text: "Hello.",
	})
	require.Error(t, err)
	apiErr, ok := err.(*middleware.APIError)
	require.True(t, ok)
	assert.Equal(t, 503, apiErr.Status)
	assert.Equal(t, MsgTranslateUnavailable, apiErr.Message)
}

func TestTranslateRateLimitedPerUser(t *testing.T) {
	h := newHarness(t, `{"translation":"你好"}`)
	ctx := context.Background()

	for i := 0; i < interpretPerMinute; i++ {
		_, err := h.service.Translate(ctx, "user-1", model.TranslateRequest{Text: "Hello."})
		require.NoErrorf(t, err, "第 %d 次调用不该失败", i+1)
	}

	_, err := h.service.Translate(ctx, "user-1", model.TranslateRequest{Text: "Hello."})
	require.Error(t, err)
	apiErr, ok := err.(*middleware.APIError)
	require.True(t, ok)
	assert.Equal(t, 429, apiErr.Status)
	assert.Equal(t, "interpret_rate_limited", apiErr.Reason)

	_, err = h.service.Translate(ctx, "user-2", model.TranslateRequest{Text: "Hello."})
	require.NoError(t, err, "限流按用户隔离")
}

func TestParseTranslation(t *testing.T) {
	out, err := parseTranslation(`{"translation":"  交期四十五天。 "}`)
	require.NoError(t, err)
	assert.Equal(t, "交期四十五天。", out)

	_, err = parseTranslation(`{"translation":"  "}`)
	require.Error(t, err, "空译文应当报错")

	_, err = parseTranslation(`{"other":"x"}`)
	require.Error(t, err, "缺 translation 字段应当报错")
}
