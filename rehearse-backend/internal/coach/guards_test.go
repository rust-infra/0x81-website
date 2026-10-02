package coach

import (
	"strings"
	"testing"

	"github.com/0x81/rehearse-backend/internal/model"
)

func validScenario() model.Scenario {
	return model.Scenario{
		ID:          "standup_update",
		Source:      model.SourcePreset,
		Category:    model.CategoryDaily,
		Language:    model.LanguageEnUS,
		Title:       "每日站会",
		Description: "汇报进度",
		Persona:     model.Persona{Name: "Alex", Role: "Tech Lead", Tone: "friendly"},
		Setting:     "meeting",
		OpeningLine: "Morning! How's it going?",
		FocusPoints: []string{"进度说清楚"},
		Difficulty:  "core",
		MaxTurns:    10,
	}
}

// max_turns 是**夹取**不是报错：客户端传 999 按 20 处理。
// 报错的话，将来上限调整会让所有老客户端直接不可用。
func TestValidateScenarioClampsMaxTurns(t *testing.T) {
	for _, tc := range []struct{ in, want uint32 }{
		{0, MinTurns},
		{1, MinTurns},
		{10, 10},
		{999, MaxTurns},
	} {
		scenario := validScenario()
		scenario.MaxTurns = tc.in
		got, err := ValidateScenario(scenario)
		if err != nil {
			t.Fatalf("max_turns=%d: 不该报错: %v", tc.in, err)
		}
		if got.MaxTurns != tc.want {
			t.Errorf("max_turns=%d 夹取为 %d, 期望 %d", tc.in, got.MaxTurns, tc.want)
		}
	}
}

func TestValidateScenarioRejectsBadEnums(t *testing.T) {
	cases := map[string]func(*model.Scenario){
		"旧 category（engineering）": func(s *model.Scenario) { s.Category = "engineering" },
		"旧 category（high_stakes）": func(s *model.Scenario) { s.Category = "high_stakes" },
		"未知 language":             func(s *model.Scenario) { s.Language = "klingon" },
		"未知 tone":                 func(s *model.Scenario) { s.Persona.Tone = "grumpy" },
		"未知 setting":              func(s *model.Scenario) { s.Setting = "elevator" },
		"未知 difficulty":           func(s *model.Scenario) { s.Difficulty = "impossible" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			scenario := validScenario()
			mutate(&scenario)
			if _, err := ValidateScenario(scenario); err == nil {
				t.Error("应当报错")
			}
		})
	}
}

// ⚠️ 长度按**字符数**算，不是字节数。用 len() 的话中文一个字算 3 字节，
// 60 字的中文标题会被误判成 180 而拒绝——这是最容易写错的一处。
func TestValidateScenarioCountsRunesNotBytes(t *testing.T) {
	scenario := validScenario()
	scenario.Title = strings.Repeat("中", maxTitleLen) // 恰好 60 个字符 = 180 字节
	if _, err := ValidateScenario(scenario); err != nil {
		t.Fatalf("60 个中文字符应当通过（按字符计），却报错: %v", err)
	}

	scenario.Title = strings.Repeat("中", maxTitleLen+1)
	if _, err := ValidateScenario(scenario); err == nil {
		t.Error("61 个字符应当被拒")
	}
}

func TestValidateScenarioRejectsTooManyFocusPoints(t *testing.T) {
	scenario := validScenario()
	scenario.FocusPoints = []string{"a", "b", "c", "d", "e", "f"}
	if _, err := ValidateScenario(scenario); err == nil {
		t.Error("6 个 focus_points 应当被拒（上限 5）")
	}
}

// 单条不超、但总数超——只看单条长度的话，40 条各 2000 字能把 prompt 撑到 8 万字。
func TestValidateHistoryEnforcesTotalLength(t *testing.T) {
	// 每条 1000 字 × 40 条 = 40000 > 12000
	history := make([]model.Turn, MaxHistoryTurns)
	for i := range history {
		history[i] = model.Turn{Role: model.RoleUser, Content: strings.Repeat("x", 1000)}
	}
	if err := ValidateHistory(history, "hello"); err == nil {
		t.Error("总长度超限应当被拒")
	}
}

func TestValidateHistoryRejectsOversizeUserText(t *testing.T) {
	history := []model.Turn{{Role: model.RoleCoach, Content: "hi"}}
	if err := ValidateHistory(history, strings.Repeat("x", MaxUserTextChars+1)); err == nil {
		t.Error("超长 user_text 应当被拒")
	}
	if err := ValidateHistory(history, "   "); err == nil {
		t.Error("空白 user_text 应当被拒")
	}
	if err := ValidateHistory(history, "ok"); err != nil {
		t.Errorf("合法输入不该报错: %v", err)
	}
}

// ⚠️ **防作弊护栏**：`completed_turns` 来自客户端，不能信任。
// 用户传 0 来无限延长会话的话，必须被 history 数出来的轮数盖过去。
func TestNextTurnIndexTakesMaxOfClaimedAndInferred(t *testing.T) {
	// history 里有 5 轮用户发言，客户端谎称 0
	history := make([]model.Turn, 0, 10)
	for i := 0; i < 5; i++ {
		history = append(history,
			model.Turn{Role: model.RoleUser, Content: "u"},
			model.Turn{Role: model.RoleCoach, Content: "c"},
		)
	}
	zero := uint32(0)
	got, err := NextTurnIndex(history, &zero, 10)
	if err != nil {
		t.Fatalf("不该报错: %v", err)
	}
	// 推断出 5 轮 → 本轮是第 6 轮。若信任客户端的 0，会得到 1。
	if got != 6 {
		t.Errorf("turn_index = %d, 期望 6（取 max(声称 0, 推断 5) + 1）", got)
	}

	// 反向：客户端声称 7（比推断的 5 大），应当采信更大的那个。
	seven := uint32(7)
	got, err = NextTurnIndex(history, &seven, 10)
	if err != nil {
		t.Fatalf("不该报错: %v", err)
	}
	if got != 8 {
		t.Errorf("turn_index = %d, 期望 8（取 max(7, 5) + 1）", got)
	}
}

func TestNextTurnIndexRejectsAtLimit(t *testing.T) {
	history := make([]model.Turn, 0, 20)
	for i := 0; i < 10; i++ {
		history = append(history, model.Turn{Role: model.RoleUser, Content: "u"})
	}
	ten := uint32(10)
	if _, err := NextTurnIndex(history, &ten, 10); err == nil {
		t.Error("达到上限应当报错")
	}
	// 上限之上也报错（不是刚好等于才算）
	eleven := uint32(11)
	if _, err := NextTurnIndex(history, &eleven, 10); err == nil {
		t.Error("超过上限应当报错")
	}
}

// 推荐表达不能复读 AI 自己的回复——否则「你可以这样回」会变成
// 「你可以这样回（原样重复我刚说的）」。
func TestSanitizeNextLinesBlocksEchoOfReply(t *testing.T) {
	reply := "Sure, let's dig into that."
	lines := []model.Expression{
		{Text: "Sure, let's dig into that.", Translation: "好，我们来聊聊。"}, // 复读
		{Text: "Can you walk me through the design?", Translation: "能讲讲设计吗？"},
	}
	got := SanitizeNextLines(lines, nil, reply)
	if len(got) != 1 {
		t.Fatalf("应当只剩 1 条，实际 %d: %+v", len(got), got)
	}
	if got[0].Text != "Can you walk me through the design?" {
		t.Errorf("留下的不是预期那条: %q", got[0].Text)
	}
}

// 也不能复读纠错里的任何一句（原文 / 改正后 / 更地道的说法 / 推荐短语）。
func TestSanitizeNextLinesBlocksEchoOfFeedback(t *testing.T) {
	feedback := &model.Feedback{
		Corrections: []model.Correction{
			{Original: "I am agree", Corrected: "I agree", ExplanationZh: "agree 本身是动词"},
		},
		BetterPhrasing: &model.BetterPhrasing{
			Original: "very good", Natural: "solid", NoteZh: "更自然",
		},
		Expressions: []model.Expression{{Text: "circle back", Translation: "回头再聊"}},
	}
	lines := []model.Expression{
		{Text: "I am agree", Translation: "我同意"},   // 复读原文
		{Text: "I agree", Translation: "我同意"},      // 复读改正
		{Text: "very good", Translation: "很好"},     // 复读 better.original
		{Text: "solid", Translation: "扎实"},         // 复读 better.natural
		{Text: "circle back", Translation: "回头再聊"}, // 复读 expressions
		{Text: "Let's take it offline.", Translation: "我们线下聊。"},
	}
	got := SanitizeNextLines(lines, feedback, "Okay.")
	if len(got) != 1 || got[0].Text != "Let's take it offline." {
		t.Fatalf("应当只剩最后一条，实际 %+v", got)
	}
}

// 比对用规范化形式：大小写与标点差异要认成同一句。
func TestSanitizeNextLinesNormalizesBeforeComparing(t *testing.T) {
	reply := "It's on track."
	lines := []model.Expression{
		{Text: "its on track", Translation: "进展顺利"},      // 只差标点/大小写
		{Text: "IT'S  ON  TRACK!!", Translation: "进展顺利"}, // 再变一次
		{Text: "The API is done.", Translation: "API 完成了。"},
	}
	got := SanitizeNextLines(lines, nil, reply)
	if len(got) != 1 || got[0].Text != "The API is done." {
		t.Fatalf("规范化比对没生效，实际 %+v", got)
	}
}

func TestSanitizeNextLinesCapsAtTwoAndDropsEmpties(t *testing.T) {
	lines := []model.Expression{
		{Text: "one", Translation: "一"},
		{Text: "  ", Translation: "空"}, // 空文本
		{Text: "two", Translation: ""}, // 空对照
		{Text: "three", Translation: "三"},
		{Text: "four", Translation: "四"},
	}
	got := SanitizeNextLines(lines, nil, "reply")
	if len(got) != MaxNextLines {
		t.Fatalf("应当最多 %d 条，实际 %d: %+v", MaxNextLines, len(got), got)
	}
	if got[0].Text != "one" || got[1].Text != "three" {
		t.Errorf("保留的应当是前两条合法的: %+v", got)
	}
}

func TestTrimReplyCutsAtSentenceBoundary(t *testing.T) {
	// 240 字上限，构造一段在 200 字处有句号的文本
	long := strings.Repeat("a", 200) + ". " + strings.Repeat("b", 100)
	got := TrimReply(long)
	if len([]rune(got)) > MaxReplyChars {
		t.Errorf("超过上限: %d", len([]rune(got)))
	}
	if !strings.HasSuffix(got, ".") {
		t.Errorf("应当在句末标点处切，实际结尾 %q", got[len(got)-10:])
	}
}

// 没有句末标点时退到空格处切，不能把单词劈成两半。
func TestTrimReplyDoesNotSplitWords(t *testing.T) {
	long := strings.Repeat("word ", 100) // 没有句号
	got := TrimReply(long)
	if strings.HasSuffix(got, "wor") || strings.HasSuffix(got, "wo") {
		t.Errorf("把单词劈开了: %q", got)
	}
	if len([]rune(got)) > MaxReplyChars {
		t.Errorf("超过上限: %d", len([]rune(got)))
	}
}

func TestTrimReplyLeavesShortTextAlone(t *testing.T) {
	if got := TrimReply("  Hello there.  "); got != "Hello there." {
		t.Errorf("短文本应当只做 trim，实际 %q", got)
	}
}

// 模型偶尔无视「no markdown fences」的要求，解析前必须容错。
func TestStripCodeFences(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"```json\n{\"a\":1}\n```", `{"a":1}`},
		{"```\n{\"a\":1}\n```", `{"a":1}`},
		{"{\"a\":1}", `{"a":1}`},
		{"  {\"a\":1}  ", `{"a":1}`},
	} {
		if got := StripCodeFences(tc.in); got != tc.want {
			t.Errorf("StripCodeFences(%q) = %q, 期望 %q", tc.in, got, tc.want)
		}
	}
}

// ⚠️ 解析失败走**降级**而不是报错：模型偶尔吐坏 JSON，
// 报 500 会让用户看到错误页，而其实还能继续对话。
func TestDegradedResponseKeepsReplyDropsFeedback(t *testing.T) {
	got := DegradedResponse("Sure, let's dig in.", 3, true)
	if got.Reply != "Sure, let's dig in." {
		t.Errorf("reply = %q", got.Reply)
	}
	if got.Feedback != nil {
		t.Error("降级响应不该带 feedback")
	}
	if !got.LimitReached {
		t.Error("limit_reached 应当透传")
	}
	if got.TurnIndex != 3 {
		t.Errorf("turn_index = %d", got.TurnIndex)
	}
	if got.Mood != model.MoodNeutral {
		t.Errorf("mood = %q, 期望 neutral", got.Mood)
	}
	if got.ReplyTranslation != nil {
		t.Error("降级响应不该有翻译")
	}

	// 完全空的原始输出也要给一句可展示的话，而不是空字符串。
	if empty := DegradedResponse("   ", 1, false); empty.Reply == "" {
		t.Error("空输出时应当给兜底文案")
	}
}

// 对话内容放在 user 侧，规则在 system 侧——这样「忽略以上指令」在结构上
// 只是用户说的一句话。
func TestBuildTranscript(t *testing.T) {
	history := []model.Turn{
		{Role: model.RoleCoach, Content: "Morning!"},
		{Role: model.RoleUser, Content: "Hi."},
	}
	got := BuildTranscript(history, "I finished the API.")
	if !strings.Contains(got, "COACH: Morning!") {
		t.Errorf("缺少 COACH 行: %s", got)
	}
	if !strings.Contains(got, "USER: Hi.") {
		t.Errorf("缺少 USER 行: %s", got)
	}
	if !strings.Contains(got, "USER (latest): I finished the API.") {
		t.Errorf("缺少最新一轮: %s", got)
	}
	// 必须明确告诉模型「按指令里的 JSON 回复」，否则它会自由发挥。
	if !strings.Contains(got, "JSON object") {
		t.Errorf("缺少输出格式提醒: %s", got)
	}
}

func TestValidateMaterial(t *testing.T) {
	if err := ValidateMaterial(model.MaterialContext{Kind: "resume", Profile: "5 年后端"}); err != nil {
		t.Errorf("合法材料不该报错: %v", err)
	}
	// v1 不扩 project_doc / perf_review（§5.3）
	if err := ValidateMaterial(model.MaterialContext{Kind: "project_doc", Profile: "x"}); err == nil {
		t.Error("project_doc 不在 v1 的 kind 白名单里")
	}
	if err := ValidateMaterial(model.MaterialContext{Kind: "resume", Profile: "  "}); err == nil {
		t.Error("空 profile 应当被拒")
	}
	if err := ValidateMaterial(model.MaterialContext{
		Kind: "resume", Profile: strings.Repeat("x", MaxMaterialChars+1),
	}); err == nil {
		t.Error("超长 profile 应当被拒")
	}
}

func TestValidateSummaryHistory(t *testing.T) {
	if err := ValidateSummaryHistory(nil); err == nil {
		t.Error("空历史应当被拒")
	}
	if err := ValidateSummaryHistory([]model.Turn{{Role: model.RoleUser, Content: "hi"}}); err != nil {
		t.Errorf("合法历史不该报错: %v", err)
	}
}
