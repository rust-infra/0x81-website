package coach

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// podcastHarness 复用 coach 的 LLM harness：整集字幕服务在同一套假 LLM
// 与内存 store 上组装，`responses` 是按调用顺序脚本化的模型输出。
func podcastHarness(t *testing.T, responses ...string) (*PodcastCaptionService, *harness) {
	t.Helper()
	h := newHarness(t, responses...)
	return h.podcast, h
}

func podcastRequest(t *testing.T, turns ...string) PodcastTranslationsRequest {
	t.Helper()
	req := PodcastTranslationsRequest{
		EpisodeID:  "english_book1_main_1_1",
		SourceHash: SourceHash(turns),
		Title:      "New Colleague Introduction",
	}
	for index, text := range turns {
		req.Turns = append(req.Turns, struct {
			Speaker string `json:"speaker"`
			Text    string `json:"text"`
		}{Speaker: speakerAt(index), Text: text})
	}
	return req
}

func speakerAt(index int) string {
	if index%2 == 0 {
		return "Interviewer"
	}
	return "Candidate"
}

// episodeJSON 造一份模型返回：每句一个译文。
func episodeJSON(t *testing.T, count int) string {
	t.Helper()
	items := make([]map[string]any, count)
	for index := 0; index < count; index++ {
		items[index] = map[string]any{
			"turn_index":  index,
			"translation": "译文" + string(rune('A'+index)),
		}
	}
	raw, err := json.Marshal(map[string]any{"translations": items})
	require.NoError(t, err)
	return string(raw)
}

func TestPodcastGenerateTranslatesWholeEpisodeInOneCall(t *testing.T) {
	response := episodeJSON(t, 3)
	service, h := podcastHarness(t, response)

	req := podcastRequest(t, "Hello.", "Hi, please introduce yourself.", "I am Alex.")
	out, err := service.Generate(context.Background(), "user-1", req)
	require.NoError(t, err)
	assert.False(t, out.Cached)
	assert.Equal(t, 3, len(out.Translations))
	assert.Equal(t, "译文A", out.Translations[0].Translation)
	assert.Equal(t, "译文C", out.Translations[2].Translation)

	// ⚠️ 核心断言：整集一次调用。逐句并发是改造前的实现，会得到 3 次调用。
	// 这个测试存在的理由就是把「看到完整对话」这件事钉住。
	assert.Equal(t, 1, h.calls, "整集只应产生一次 LLM 调用")
	user := h.userMessage(t, 0)
	assert.Contains(t, user, "I am Alex.", "user message 应当带上整集台词")
	assert.Contains(t, user, "episode_title", "user message 应当带上集标题")
}

func TestPodcastGenerateIsIdempotentOnceStored(t *testing.T) {
	response := episodeJSON(t, 2)
	service, h := podcastHarness(t, response)

	req := podcastRequest(t, "One.", "Two.")
	first, err := service.Generate(context.Background(), "user-1", req)
	require.NoError(t, err)
	assert.False(t, first.Cached)
	callsAfterFirst := h.calls

	second, err := service.Generate(context.Background(), "user-1", req)
	require.NoError(t, err)
	assert.True(t, second.Cached, "已有完整译文时应当直接返回缓存")
	assert.Equal(t, callsAfterFirst, h.calls, "缓存命中不该再调 LLM")
	assert.Equal(t, first.Translations, second.Translations)
}

func TestPodcastGenerateInvalidatesOnSourceHashChange(t *testing.T) {
	service, h := podcastHarness(t, episodeJSON(t, 2), episodeJSON(t, 2))

	oldReq := podcastRequest(t, "One.", "Two.")
	_, err := service.Generate(context.Background(), "user-1", oldReq)
	require.NoError(t, err)

	// 台词改了：指纹变了，旧译文不能再用。
	newReq := podcastRequest(t, "One.", "Two, revised.")
	_, err = service.Generate(context.Background(), "user-1", newReq)
	require.NoError(t, err)
	assert.Equal(t, 2, h.calls, "台词变了应当重新生成")
}

func TestPodcastStoredNeverCallsLLM(t *testing.T) {
	service, h := podcastHarness(t, episodeJSON(t, 2))

	out, err := service.Stored(context.Background(), podcastRequest(t, "One.", "Two."))
	require.NoError(t, err)
	assert.Empty(t, out.Translations, "还没生成时返回空，而不是报错")
	assert.Equal(t, 0, h.calls, "读取路径绝不能调 LLM")
}

func TestPodcastGenerateRejectsMismatchedTranslationCount(t *testing.T) {
	service, _ := podcastHarness(t, episodeJSON(t, 2))

	_, err := service.Generate(context.Background(), "user-1", podcastRequest(t, "One.", "Two.", "Three."))
	require.Error(t, err)
	apiErr, ok := err.(*middleware.APIError)
	require.True(t, ok, "应当是 APIError")
	assert.Equal(t, 503, apiErr.Status, "数量对不上视为上游异常，不写半成品进库")
}

func TestPodcastGenerateRejectsDuplicateTurnIndex(t *testing.T) {
	service, _ := podcastHarness(t, `{"translations":[
		{"turn_index":0,"translation":"甲"},
		{"turn_index":0,"translation":"乙"}]}`)

	_, err := service.Generate(context.Background(), "user-1", podcastRequest(t, "One.", "Two."))
	require.Error(t, err)
}

func TestPodcastGenerateRejectsBadSourceHash(t *testing.T) {
	service, h := podcastHarness(t)
	req := podcastRequest(t, "One.")
	req.SourceHash = "not-a-hash"

	_, err := service.Generate(context.Background(), "user-1", req)
	require.Error(t, err)
	apiErr, ok := err.(*middleware.APIError)
	require.True(t, ok)
	assert.Equal(t, 400, apiErr.Status)
	assert.Equal(t, 0, h.calls)
}

func TestPodcastGenerateRequiresConfiguredLLM(t *testing.T) {
	h := newHarnessNoLLM(t)

	_, err := h.podcast.Generate(context.Background(), "user-1", podcastRequest(t, "One."))
	require.Error(t, err)
	apiErr, ok := err.(*middleware.APIError)
	require.True(t, ok)
	assert.Equal(t, 503, apiErr.Status)
}

func TestSourceHashDependsOnOrder(t *testing.T) {
	assert.NotEqual(t, SourceHash([]string{"a", "b"}), SourceHash([]string{"b", "a"}))
	assert.Equal(t, SourceHash([]string{"a", "b"}), SourceHash([]string{" a ", "b "}))
}
