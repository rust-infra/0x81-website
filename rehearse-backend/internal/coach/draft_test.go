package coach

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/0x81/rehearse-backend/internal/model"
)

// 对齐 Rust 的 `draft_payload_is_forced_to_custom_source`（`coach.rs:812`），
// 字段名换成 §7.6 的新契约。
const validDraftPayload = `{"category":"daily","title":"跨时区交接","description":"和澳洲同事交接任务",` +
	`"persona":{"name":"Emma","role":"Teammate","accent":"en-AU","tone":"friendly"},` +
	`"setting":"meeting","opening_line":"Hey, got a minute to hand over?",` +
	`"opening_line_translation":"嘿，有时间交接一下吗？",` +
	`"opening_next_lines":[{"text":"Sure, let's start with the current state.","translation":"好，我们先说当前状态。"}],` +
	`"focus_points":["说清状态"],"difficulty":"core","max_turns":10}`

func fixtureDraftRequest() model.ScenarioDraftRequest {
	return model.ScenarioDraftRequest{Description: "和澳洲同事交接任务"}
}

func TestDraftForcesCustomSourceAndGeneratedID(t *testing.T) {
	h := newHarness(t, validDraftPayload)
	out, err := h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())
	if err != nil {
		t.Fatal(err)
	}
	if out.Source != model.SourceCustom {
		t.Fatalf("source = %q，期望 custom", out.Source)
	}
	if !strings.HasPrefix(out.ID, "custom_") {
		t.Fatalf("id = %q，期望 custom_ 前缀", out.ID)
	}
	// Rust 用 `Uuid::new_v4().simple()`：32 个十六进制字符，无连字符。
	if len(out.ID) != len("custom_")+32 {
		t.Fatalf("id 长度 = %d，期望 %d", len(out.ID), len("custom_")+32)
	}
	if strings.ContainsAny(out.ID, "-") {
		t.Fatalf("id 不该有连字符：%q", out.ID)
	}
	if out.Title != "跨时区交接" || out.OpeningLineTranslation != "嘿，有时间交接一下吗？" {
		t.Fatalf("out = %+v", out)
	}
	if out.Language != model.LanguageEnUS {
		t.Fatalf("language = %q，期望缺省 en-US", out.Language)
	}
	if out.Persona.Accent == nil || *out.Persona.Accent != model.LanguageEnAU {
		t.Fatalf("persona.accent = %v", out.Persona.Accent)
	}
}

// 每次生成的 id 都不同——否则客户端会把两个不同的自定义场景当成同一个。
func TestDraftGeneratesUniqueIDs(t *testing.T) {
	h := newHarness(t, validDraftPayload)
	first, err := h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())
	if err != nil {
		t.Fatal(err)
	}
	second, err := h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == second.ID {
		t.Fatalf("两次生成的 id 相同：%q", first.ID)
	}
}

// 对齐 Rust 的 `draft_without_opening_translation_parses_as_empty`。
func TestDraftWithoutOpeningTranslation(t *testing.T) {
	payload := `{"category":"daily","title":"站会","description":"同步进度",` +
		`"persona":{"name":"Alex","role":"Tech Lead","accent":"en-US","tone":"friendly"},` +
		`"setting":"meeting","opening_line":"Morning!","focus_points":[],"difficulty":"easy","max_turns":6}`
	h := newHarness(t, payload)

	out, err := h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())
	if err != nil {
		t.Fatal(err)
	}
	if out.OpeningLineTranslation != "" {
		t.Fatalf("opening_line_translation = %q，期望空串", out.OpeningLineTranslation)
	}
	// focus_points 缺失时要序列化成 `[]`。
	if out.OpeningNextLines == nil || len(out.OpeningNextLines) != 0 {
		t.Fatalf("opening_next_lines = %+v，期望空数组", out.OpeningNextLines)
	}
	if out.FocusPoints == nil {
		t.Fatal("focus_points 应当是 []，不是 null")
	}
}

// 对齐 Rust 的 `draft_keeps_opening_suggestions_and_caps_them`：
// 空行丢掉、最多留两条。
func TestDraftSanitizesOpeningSuggestions(t *testing.T) {
	payload := `{"category":"daily","title":"站会","description":"同步进度",` +
		`"persona":{"name":"Alex","role":"Tech Lead","accent":"en-US","tone":"friendly"},` +
		`"setting":"meeting","opening_line":"Morning!","opening_line_translation":"早！",` +
		`"opening_next_lines":[{"text":"Sure, let's start with the current state.","translation":"好，我们先说当前状态。"},` +
		`{"text":"   ","translation":"x"},` +
		`{"text":"I'm mid-migration, here's where things stand.","translation":"我在迁移中。"},` +
		`{"text":"third","translation":"三"}],` +
		`"focus_points":[],"difficulty":"easy","max_turns":6}`
	h := newHarness(t, payload)

	out, err := h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())
	if err != nil {
		t.Fatal(err)
	}
	if len(out.OpeningNextLines) != 2 {
		t.Fatalf("opening_next_lines = %+v，期望 2 条", out.OpeningNextLines)
	}
	if out.OpeningNextLines[0].Text != "Sure, let's start with the current state." {
		t.Fatalf("第一条 = %q", out.OpeningNextLines[0].Text)
	}
	if out.OpeningNextLines[1].Text != "I'm mid-migration, here's where things stand." {
		t.Fatalf("第二条 = %q（空行没被丢掉，或者上限不对）", out.OpeningNextLines[1].Text)
	}
}

// 对齐 Rust 的 `draft_drops_overlong_opening_suggestions`：推荐语是聊天里的
// 一张小卡片，超长（>160 字符）的整条丢掉。
func TestDraftDropsOverlongOpeningSuggestions(t *testing.T) {
	long := strings.Repeat("x", 200)
	payload := `{"category":"daily","title":"站会","description":"同步进度",` +
		`"persona":{"name":"Alex","role":"Tech Lead","accent":"en-US","tone":"friendly"},` +
		`"setting":"meeting","opening_line":"Morning!",` +
		`"opening_next_lines":[{"text":"` + long + `","translation":"中"},` +
		`{"text":"Short one.","translation":"短的"}],` +
		`"focus_points":[],"difficulty":"easy","max_turns":6}`
	h := newHarness(t, payload)

	out, err := h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())
	if err != nil {
		t.Fatal(err)
	}
	if len(out.OpeningNextLines) != 1 || out.OpeningNextLines[0].Text != "Short one." {
		t.Fatalf("opening_next_lines = %+v", out.OpeningNextLines)
	}
}

// 对齐 Rust 的 `draft_rejects_overlong_title`：模型返回的草稿也要过完整校验，
// 否则用户会存下一个永远发不出去的场景。
func TestDraftRejectsInvalidModelOutput(t *testing.T) {
	cases := map[string]string{
		"标题超长": `{"category":"daily","title":"` + strings.Repeat("x", 61) + `","description":"d",` +
			`"persona":{"name":"A","role":"R","accent":"en-US","tone":"friendly"},` +
			`"setting":"meeting","opening_line":"Hi","focus_points":[],"difficulty":"easy","max_turns":6}`,
		"未知 category": `{"category":"engineering","title":"t","description":"d",` +
			`"persona":{"name":"A","role":"R","accent":"en-US","tone":"friendly"},` +
			`"setting":"meeting","opening_line":"Hi","focus_points":[],"difficulty":"easy","max_turns":6}`,
		"未知 tone": `{"category":"daily","title":"t","description":"d",` +
			`"persona":{"name":"A","role":"R","accent":"en-US","tone":"sassy"},` +
			`"setting":"meeting","opening_line":"Hi","focus_points":[],"difficulty":"easy","max_turns":6}`,
		"focus_points 过多": `{"category":"daily","title":"t","description":"d",` +
			`"persona":{"name":"A","role":"R","accent":"en-US","tone":"friendly"},` +
			`"setting":"meeting","opening_line":"Hi",` +
			`"focus_points":["1","2","3","4","5","6"],"difficulty":"easy","max_turns":6}`,
		"非法 JSON": "```json\n{ broken\n```",
	}
	for name, payload := range cases {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t, payload)
			if err := apiError(t, mustErr(h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest()))); err.Status != 400 {
				t.Fatalf("status = %d，期望 400", err.Status)
			}
		})
	}
}

// max_turns 是夹取而不是报错（与场景校验的语义一致）。
func TestDraftClampsMaxTurns(t *testing.T) {
	payload := `{"category":"daily","title":"站会","description":"同步进度",` +
		`"persona":{"name":"Alex","role":"Tech Lead","accent":"en-US","tone":"friendly"},` +
		`"setting":"meeting","opening_line":"Morning!","focus_points":[],"difficulty":"easy","max_turns":99}`
	h := newHarness(t, payload)

	out, err := h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())
	if err != nil {
		t.Fatal(err)
	}
	if out.MaxTurns != MaxTurns {
		t.Fatalf("max_turns = %d，期望夹到 %d", out.MaxTurns, MaxTurns)
	}
}

// 描述为空 / 超长 → 400，且不调 LLM。
func TestDraftValidatesDescriptionBeforeLLM(t *testing.T) {
	cases := map[string]string{
		"空":  "   ",
		"超长": strings.Repeat("字", maxDraftDescriptionChars+1),
	}
	for name, description := range cases {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t, validDraftPayload)
			err := apiError(t, mustErr(h.service.DraftScenario(ctx(), "usr_1",
				model.ScenarioDraftRequest{Description: description})))
			if err.Status != 400 {
				t.Fatalf("status = %d", err.Status)
			}
			if h.calls != 0 {
				t.Fatalf("非法描述不该调 LLM，实际 %d 次", h.calls)
			}
		})
	}
}

// 草稿要扣一次额度——它也是一次 LLM 调用（Rust `coach.rs:335`）。
func TestDraftConsumesQuotaOnce(t *testing.T) {
	h := newHarness(t, validDraftPayload)
	if _, err := h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest()); err != nil {
		t.Fatal(err)
	}
	if used := h.store.Usage("usr_1", dayKey(now())); used != 1 {
		t.Fatalf("已用额度 = %d，期望 1", used)
	}
}

// 额度用尽时草稿同样被挡，且**不调 LLM**——草稿是一次真实的 LLM 调用，
// 不能绕过配额。
func TestDraftQuotaExceededBlocksWithoutLLMCall(t *testing.T) {
	h := newHarness(t, validDraftPayload)
	h.setQuota(t, 1, true)

	if _, err := h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest()); err != nil {
		t.Fatalf("第一次应当成功：%v", err)
	}
	err := apiError(t, mustErr(h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())))
	if err.Status != 429 {
		t.Fatalf("status = %d，期望 429", err.Status)
	}
	if h.calls != 1 {
		t.Fatalf("超限的那次不该调 LLM，总调用次数 = %d", h.calls)
	}
}

// enabled=false 时草稿不限量（与 /turn 的语义一致）。
func TestDraftUnlimitedWhenQuotaDisabled(t *testing.T) {
	h := newHarness(t, validDraftPayload)
	h.setQuota(t, 5, false)

	for i := 1; i <= 3; i++ {
		if _, err := h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest()); err != nil {
			t.Fatalf("第 %d 次不该失败：%v", i, err)
		}
	}
}

// 上游失败 → 503，文案与 Rust 一致。
func TestDraftUpstreamFailure(t *testing.T) {
	h := newHarness(t, validDraftPayload)
	h.failures = 5
	err := apiError(t, mustErr(h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())))
	if err.Status != 503 || err.Message != MsgDraftUnavailable {
		t.Fatalf("err = %+v", err)
	}
}

// 中文演练在阶段 7 之前不可用，草稿也拒——生成一个练不了的自定义场景
// 只会让用户更困惑。
func TestDraftRejectsChineseLanguage(t *testing.T) {
	h := newHarness(t, validDraftPayload)
	zh := model.LanguageZhCN
	req := fixtureDraftRequest()
	req.Language = &zh

	if err := apiError(t, mustErr(h.service.DraftScenario(ctx(), "usr_1", req))); err.Status != 400 {
		t.Fatalf("status = %d", err.Status)
	}
	if h.calls != 0 {
		t.Fatalf("不该调 LLM，实际 %d 次", h.calls)
	}
}

func TestDraftRejectsInvalidLanguage(t *testing.T) {
	h := newHarness(t, validDraftPayload)
	bad := model.Language("en-XX")
	req := fixtureDraftRequest()
	req.Language = &bad

	if err := apiError(t, mustErr(h.service.DraftScenario(ctx(), "usr_1", req))); err.Status != 400 {
		t.Fatalf("status = %d", err.Status)
	}
}

// 草稿的 system prompt 必须用**新契约的键名**——模板里写的键名就是模型会
// 吐出来的键名，留着 `locale` / `en` / `zh` 会让解析层对不上，
// 症状是「草稿永远是空的」。
func TestDraftPromptUsesNewFieldNames(t *testing.T) {
	h := newHarness(t, validDraftPayload)
	if _, err := h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest()); err != nil {
		t.Fatal(err)
	}
	prompt := h.systemPrompt(t, 0)

	for _, want := range []string{
		`"category":"interview|pitch|hard_talk|daily"`,
		`"accent":"en-US|en-GB|en-IN|en-AU|null"`,
		`"opening_line_translation":"..."`,
		`"opening_next_lines":[{"text":"...","translation":"..."}]`,
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt 缺少新契约片段 %s", want)
		}
	}
	for _, unwanted := range []string{"opening_line_zh", "persona.locale", `"en":"...","zh":"..."`, "high_stakes"} {
		if strings.Contains(prompt, unwanted) {
			t.Errorf("prompt 残留旧字段名 %q", unwanted)
		}
	}
}

// 草稿请求的 JSON 里 `language` 是可选的。
func TestDraftRequestJSONShape(t *testing.T) {
	var req model.ScenarioDraftRequest
	if err := json.Unmarshal([]byte(`{"description":"和澳洲同事交接"}`), &req); err != nil {
		t.Fatal(err)
	}
	if req.Language != nil {
		t.Fatalf("language = %v，期望 nil", req.Language)
	}
}
