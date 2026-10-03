package coach

import (
	"testing"

	"github.com/0x81/rehearse-backend/internal/model"
	"github.com/stretchr/testify/require"
)

const validSummaryPayload = `{"overall_zh":"表达清楚","overall_en":"Clear",` +
	`"strengths":["信息完整","语气自然","结构清楚","第四条应当被截掉"],` +
	`"improvements":["时态","衔接词"],` +
	`"expressions":[{"text":"I'm on it.","translation":"我在做。"},` +
	`{"text":"b","translation":"b"},{"text":"c","translation":"c"},{"text":"d","translation":"d"}]}`

func fixtureSummaryRequest() model.SummaryRequest {
	return model.SummaryRequest{
		Scenario: fixtureScenario(),
		History: []model.Turn{
			{Role: model.RoleCoach, Content: "Morning!"},
			{Role: model.RoleUser, Content: "I'm on the API."},
			{Role: model.RoleCoach, Content: "Nice."},
			{Role: model.RoleUser, Content: "Yes."},
		},
	}
}

// 对齐 Rust 的 `parses_summary_payload_and_fills_stats`：统计由服务端算，
// 而且 strengths / improvements / expressions 各截到 3 条。
func TestSummaryParsesPayloadAndFillsStats(t *testing.T) {
	h := newHarness(t, validSummaryPayload)
	out, err := h.service.Summary(ctx(), fixtureSummaryRequest())
	require.NoError(t, err)
	require.Equal(t, "表达清楚", out.OverallZh, "overall_zh")
	require.Equal(t, "Clear", out.OverallEn, "overall_en")
	require.Len(t, out.Strengths, 3, "strengths 期望截到 3 条")
	require.Len(t, out.Improvements, 2, "improvements")
	require.Len(t, out.Expressions, 3, "expressions 期望截到 3 条")
	// "I'm on the API." 是 15 字符，"Yes." 是 4 字符 → 19
	require.Equal(t, uint32(2), out.Stats.Turns, "stats turns")
	require.Equal(t, uint32(19), out.Stats.UserChars, "stats user_chars")
	require.Zero(t, out.Stats.Corrections, "corrections 上游固定为 0")
}

// 复盘**不扣额度**——Rust 的 summary 里没有 quota 调用（`coach.rs:209-258`）。
// 这条容易在「顺手统一」时被改掉，所以钉住。
func TestSummaryDoesNotConsumeQuota(t *testing.T) {
	h := newHarness(t, validSummaryPayload)
	_, err := h.service.Summary(ctx(), fixtureSummaryRequest())
	require.NoError(t, err)
	used := h.store.Usage("usr_1", dayKey(now()))
	require.Zero(t, used, "复盘不该扣额度")
}

// 对齐 Rust 的 `summary_rejects_empty_overall`。
func TestSummaryRejectsEmptyOverall(t *testing.T) {
	h := newHarness(t, `{"overall_zh":"","overall_en":"","strengths":[],"improvements":[],"expressions":[]}`)
	err := apiError(t, mustErr(h.service.Summary(ctx(), fixtureSummaryRequest())))
	require.Equal(t, 400, err.Status, "status")
	require.Equal(t, "summary was empty", err.Message, "message")
}

// 复盘没有降级路径：模型吐出非法 JSON 就是 400（上游既有行为）。
func TestSummaryRejectsUnparseableOutput(t *testing.T) {
	h := newHarness(t, "not json at all")
	err := apiError(t, mustErr(h.service.Summary(ctx(), fixtureSummaryRequest())))
	require.Equal(t, 400, err.Status, "status")
	require.Contains(t, err.Message, "invalid summary JSON", "message")
}

// 对齐 Rust 的 `parses_interview_feedback_when_present` 与
// `regular_summary_has_no_interview_feedback`。
func TestSummaryInterviewFeedback(t *testing.T) {
	payload := `{"overall_zh":"表达清楚","overall_en":"Clear","strengths":[],"improvements":[],` +
		`"expressions":[],"interview_feedback":{"star_structure":"Situation is missing",` +
		`"quantified_impact":"Add latency numbers","weak_spots":["ownership","trade-offs"]}}`
	h := newHarness(t, payload)

	req := fixtureSummaryRequest()
	req.Material = &model.MaterialContext{Kind: "resume", Profile: "5 年后端"}
	out, err := h.service.Summary(ctx(), req)
	require.NoError(t, err)
	require.NotNil(t, out.InterviewFeedback, "期望有 interview_feedback")
	require.Equal(t, "Situation is missing", out.InterviewFeedback.StarStructure, "star_structure")
	require.Len(t, out.InterviewFeedback.WeakSpots, 2, "weak_spots")
}

func TestSummaryWithoutInterviewFeedback(t *testing.T) {
	h := newHarness(t, validSummaryPayload)
	out, err := h.service.Summary(ctx(), fixtureSummaryRequest())
	require.NoError(t, err)
	require.Nil(t, out.InterviewFeedback, "普通复盘不该有 interview_feedback")
}

// weak_spots 缺失时要序列化成 `[]`，不能是 null（同 feedback.corrections）。
func TestSummaryNormalizesEmptyWeakSpots(t *testing.T) {
	payload := `{"overall_zh":"ok","overall_en":"ok","strengths":[],"improvements":[],"expressions":[],` +
		`"interview_feedback":{"star_structure":"s","quantified_impact":"q"}}`
	h := newHarness(t, payload)
	out, err := h.service.Summary(ctx(), fixtureSummaryRequest())
	require.NoError(t, err)
	require.NotNil(t, out.InterviewFeedback.WeakSpots, "weak_spots 应当是 []，不是 null")
}

// ⚠️ 默认目标是 **Chinese**，照搬 Rust 的 `locale.unwrap_or("zh-CN")`
// （`coach.rs:227`）。复盘的读者是中文母语的学习者。
func TestSummaryDefaultsToChineseTarget(t *testing.T) {
	h := newHarness(t, validSummaryPayload)
	_, err := h.service.Summary(ctx(), fixtureSummaryRequest())
	require.NoError(t, err)
	user := h.userMessage(t, 0)
	require.Contains(t, user, "Write strengths/improvements/expressions in Chinese.", "user message")
	require.Contains(t, user, "(end of session)", "user message 应当以「会话结束」收尾")
}

func TestSummaryEnglishTargetWhenLanguageIsEnglish(t *testing.T) {
	h := newHarness(t, validSummaryPayload)
	req := fixtureSummaryRequest()
	en := model.LanguageEnGB
	req.Language = &en
	_, err := h.service.Summary(ctx(), req)
	require.NoError(t, err)
	require.Contains(t, h.userMessage(t, 0), "in English.", "user message")
}

// 空历史没法复盘——这是复盘与单轮的一条结构差异。
func TestSummaryRejectsEmptyHistory(t *testing.T) {
	h := newHarness(t, validSummaryPayload)
	req := fixtureSummaryRequest()
	req.History = []model.Turn{}
	err := apiError(t, mustErr(h.service.Summary(ctx(), req)))
	require.Equal(t, 400, err.Status, "status")
	require.Equal(t, "history is required", err.Message, "message")
	require.Zero(t, h.calls, "空历史不该调 LLM")
}

// 复盘同样在阶段 7 之前拒绝中文。
func TestSummaryRejectsChineseLanguage(t *testing.T) {
	h := newHarness(t, validSummaryPayload)
	req := fixtureSummaryRequest()
	zh := model.LanguageZhCN
	req.Language = &zh

	err := apiError(t, mustErr(h.service.Summary(ctx(), req)))
	require.Equal(t, 400, err.Status, "status")
	require.Zero(t, h.calls, "不该调 LLM")
}

// 上游失败 → 503，文案与 Rust 一致。
func TestSummaryUpstreamFailure(t *testing.T) {
	h := newHarness(t, validSummaryPayload)
	h.failures = 5
	err := apiError(t, mustErr(h.service.Summary(ctx(), fixtureSummaryRequest())))
	require.Equal(t, 503, err.Status, "status")
	require.Equal(t, MsgSummaryUnavailable, err.Message, "message")
	// 复盘不重试：Rust 只调一次（`coach.rs:238`）。
	require.Equal(t, 1, h.calls, "LLM 调用次数 期望 1（复盘不重试）")
}
