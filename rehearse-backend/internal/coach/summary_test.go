package coach

import (
	"strings"
	"testing"

	"github.com/0x81/rehearse-backend/internal/model"
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
	if err != nil {
		t.Fatal(err)
	}
	if out.OverallZh != "表达清楚" || out.OverallEn != "Clear" {
		t.Fatalf("out = %+v", out)
	}
	if len(out.Strengths) != 3 {
		t.Fatalf("strengths = %+v，期望截到 3 条", out.Strengths)
	}
	if len(out.Improvements) != 2 {
		t.Fatalf("improvements = %+v", out.Improvements)
	}
	if len(out.Expressions) != 3 {
		t.Fatalf("expressions = %+v，期望截到 3 条", out.Expressions)
	}
	// "I'm on the API." 是 15 字符，"Yes." 是 4 字符 → 19
	if out.Stats.Turns != 2 || out.Stats.UserChars != 19 {
		t.Fatalf("stats = %+v，期望 turns=2 user_chars=19", out.Stats)
	}
	if out.Stats.Corrections != 0 {
		t.Fatalf("corrections = %d，上游固定为 0", out.Stats.Corrections)
	}
}

// 复盘**不扣额度**——Rust 的 summary 里没有 quota 调用（`coach.rs:209-258`）。
// 这条容易在「顺手统一」时被改掉，所以钉住。
func TestSummaryDoesNotConsumeQuota(t *testing.T) {
	h := newHarness(t, validSummaryPayload)
	if _, err := h.service.Summary(ctx(), fixtureSummaryRequest()); err != nil {
		t.Fatal(err)
	}
	if used := h.store.Usage("usr_1", dayKey(now())); used != 0 {
		t.Fatalf("复盘不该扣额度，已用 = %d", used)
	}
}

// 对齐 Rust 的 `summary_rejects_empty_overall`。
func TestSummaryRejectsEmptyOverall(t *testing.T) {
	h := newHarness(t, `{"overall_zh":"","overall_en":"","strengths":[],"improvements":[],"expressions":[]}`)
	err := apiError(t, mustErr(h.service.Summary(ctx(), fixtureSummaryRequest())))
	if err.Status != 400 || err.Message != "summary was empty" {
		t.Fatalf("err = %+v", err)
	}
}

// 复盘没有降级路径：模型吐出非法 JSON 就是 400（上游既有行为）。
func TestSummaryRejectsUnparseableOutput(t *testing.T) {
	h := newHarness(t, "not json at all")
	err := apiError(t, mustErr(h.service.Summary(ctx(), fixtureSummaryRequest())))
	if err.Status != 400 || !strings.Contains(err.Message, "invalid summary JSON") {
		t.Fatalf("err = %+v", err)
	}
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
	if err != nil {
		t.Fatal(err)
	}
	if out.InterviewFeedback == nil {
		t.Fatal("期望有 interview_feedback")
	}
	if out.InterviewFeedback.StarStructure != "Situation is missing" {
		t.Fatalf("interview_feedback = %+v", out.InterviewFeedback)
	}
	if len(out.InterviewFeedback.WeakSpots) != 2 {
		t.Fatalf("weak_spots = %+v", out.InterviewFeedback.WeakSpots)
	}
}

func TestSummaryWithoutInterviewFeedback(t *testing.T) {
	h := newHarness(t, validSummaryPayload)
	out, err := h.service.Summary(ctx(), fixtureSummaryRequest())
	if err != nil {
		t.Fatal(err)
	}
	if out.InterviewFeedback != nil {
		t.Fatalf("普通复盘不该有 interview_feedback：%+v", out.InterviewFeedback)
	}
}

// weak_spots 缺失时要序列化成 `[]`，不能是 null（同 feedback.corrections）。
func TestSummaryNormalizesEmptyWeakSpots(t *testing.T) {
	payload := `{"overall_zh":"ok","overall_en":"ok","strengths":[],"improvements":[],"expressions":[],` +
		`"interview_feedback":{"star_structure":"s","quantified_impact":"q"}}`
	h := newHarness(t, payload)
	out, err := h.service.Summary(ctx(), fixtureSummaryRequest())
	if err != nil {
		t.Fatal(err)
	}
	if out.InterviewFeedback.WeakSpots == nil {
		t.Fatal("weak_spots 应当是 []，不是 null")
	}
}

// ⚠️ 默认目标是 **Chinese**，照搬 Rust 的 `locale.unwrap_or("zh-CN")`
// （`coach.rs:227`）。复盘的读者是中文母语的学习者。
func TestSummaryDefaultsToChineseTarget(t *testing.T) {
	h := newHarness(t, validSummaryPayload)
	if _, err := h.service.Summary(ctx(), fixtureSummaryRequest()); err != nil {
		t.Fatal(err)
	}
	user := h.userMessage(t, 0)
	if !strings.Contains(user, "Write strengths/improvements/expressions in Chinese.") {
		t.Fatalf("user message = %s", user)
	}
	if !strings.Contains(user, "(end of session)") {
		t.Fatalf("user message 应当以「会话结束」收尾：%s", user)
	}
}

func TestSummaryEnglishTargetWhenLanguageIsEnglish(t *testing.T) {
	h := newHarness(t, validSummaryPayload)
	req := fixtureSummaryRequest()
	en := model.LanguageEnGB
	req.Language = &en
	if _, err := h.service.Summary(ctx(), req); err != nil {
		t.Fatal(err)
	}
	if user := h.userMessage(t, 0); !strings.Contains(user, "in English.") {
		t.Fatalf("user message = %s", user)
	}
}

// 空历史没法复盘——这是复盘与单轮的一条结构差异。
func TestSummaryRejectsEmptyHistory(t *testing.T) {
	h := newHarness(t, validSummaryPayload)
	req := fixtureSummaryRequest()
	req.History = []model.Turn{}
	err := apiError(t, mustErr(h.service.Summary(ctx(), req)))
	if err.Status != 400 || err.Message != "history is required" {
		t.Fatalf("err = %+v", err)
	}
	if h.calls != 0 {
		t.Fatalf("空历史不该调 LLM，实际 %d 次", h.calls)
	}
}

// 复盘同样在阶段 7 之前拒绝中文。
func TestSummaryRejectsChineseLanguage(t *testing.T) {
	h := newHarness(t, validSummaryPayload)
	req := fixtureSummaryRequest()
	zh := model.LanguageZhCN
	req.Language = &zh

	if err := apiError(t, mustErr(h.service.Summary(ctx(), req))); err.Status != 400 {
		t.Fatalf("status = %d", err.Status)
	}
	if h.calls != 0 {
		t.Fatalf("不该调 LLM，实际 %d 次", h.calls)
	}
}

// 上游失败 → 503，文案与 Rust 一致。
func TestSummaryUpstreamFailure(t *testing.T) {
	h := newHarness(t, validSummaryPayload)
	h.failures = 5
	err := apiError(t, mustErr(h.service.Summary(ctx(), fixtureSummaryRequest())))
	if err.Status != 503 || err.Message != MsgSummaryUnavailable {
		t.Fatalf("err = %+v", err)
	}
	// 复盘不重试：Rust 只调一次（`coach.rs:238`）。
	if h.calls != 1 {
		t.Fatalf("LLM 调用次数 = %d，期望 1（复盘不重试）", h.calls)
	}
}
