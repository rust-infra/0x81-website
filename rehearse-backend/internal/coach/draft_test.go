package coach

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/0x81/rehearse-backend/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
	require.NoError(t, err)
	require.Equal(t, model.SourceCustom, out.Source, "source")
	require.Truef(t, strings.HasPrefix(out.ID, "custom_"), "id = %q，期望 custom_ 前缀", out.ID)
	// Rust 用 `Uuid::new_v4().simple()`：32 个十六进制字符，无连字符。
	require.Len(t, out.ID, len("custom_")+32, "id 长度")
	require.NotContains(t, out.ID, "-", "id 不该有连字符")
	require.Equal(t, "跨时区交接", out.Title, "title")
	require.Equal(t, "嘿，有时间交接一下吗？", out.OpeningLineTranslation, "opening_line_translation")
	require.Equal(t, model.LanguageEnUS, out.Language, "language 期望缺省 en-US")
	require.NotNil(t, out.Persona.Accent, "persona.accent")
	require.Equal(t, model.LanguageEnAU, *out.Persona.Accent, "persona.accent")
}

// 每次生成的 id 都不同——否则客户端会把两个不同的自定义场景当成同一个。
func TestDraftGeneratesUniqueIDs(t *testing.T) {
	h := newHarness(t, validDraftPayload)
	first, err := h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())
	require.NoError(t, err)
	second, err := h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())
	require.NoError(t, err)
	require.NotEqual(t, first.ID, second.ID, "两次生成的 id 不该相同")
}

// 对齐 Rust 的 `draft_without_opening_translation_parses_as_empty`。
func TestDraftWithoutOpeningTranslation(t *testing.T) {
	payload := `{"category":"daily","title":"站会","description":"同步进度",` +
		`"persona":{"name":"Alex","role":"Tech Lead","accent":"en-US","tone":"friendly"},` +
		`"setting":"meeting","opening_line":"Morning!","focus_points":[],"difficulty":"easy","max_turns":6}`
	h := newHarness(t, payload)

	out, err := h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())
	require.NoError(t, err)
	require.Empty(t, out.OpeningLineTranslation, "opening_line_translation 期望空串")
	// focus_points 缺失时要序列化成 `[]`。
	require.NotNil(t, out.OpeningNextLines, "opening_next_lines 期望空数组")
	require.Empty(t, out.OpeningNextLines, "opening_next_lines 期望空数组")
	require.NotNil(t, out.FocusPoints, "focus_points 应当是 []，不是 null")
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
	require.NoError(t, err)
	require.Len(t, out.OpeningNextLines, 2, "opening_next_lines 期望 2 条")
	require.Equal(t, "Sure, let's start with the current state.", out.OpeningNextLines[0].Text, "第一条")
	require.Equal(t, "I'm mid-migration, here's where things stand.", out.OpeningNextLines[1].Text,
		"第二条（空行没被丢掉，或者上限不对）")
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
	require.NoError(t, err)
	require.Len(t, out.OpeningNextLines, 1, "opening_next_lines")
	require.Equal(t, "Short one.", out.OpeningNextLines[0].Text, "opening_next_lines[0].Text")
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
			err := apiError(t, mustErr(h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())))
			require.Equal(t, 400, err.Status, "status")
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
	require.NoError(t, err)
	require.Equal(t, uint32(MaxTurns), out.MaxTurns, "max_turns 期望夹到上限")
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
			require.Equal(t, 400, err.Status, "status")
			require.Zero(t, h.calls, "非法描述不该调 LLM")
		})
	}
}

// 草稿要扣一次额度——它也是一次 LLM 调用（Rust `coach.rs:335`）。
func TestDraftConsumesQuotaOnce(t *testing.T) {
	h := newHarness(t, validDraftPayload)
	_, err := h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())
	require.NoError(t, err)
	used := h.store.Usage("usr_1", dayKey(now()))
	require.Equal(t, uint32(1), used, "已用额度")
}

// 额度用尽时草稿同样被挡，且**不调 LLM**——草稿是一次真实的 LLM 调用，
// 不能绕过配额。
func TestDraftQuotaExceededBlocksWithoutLLMCall(t *testing.T) {
	h := newHarness(t, validDraftPayload)
	h.setQuota(t, 1, true)

	_, err := h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())
	require.NoError(t, err, "第一次应当成功")
	apiErr := apiError(t, mustErr(h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())))
	require.Equal(t, 429, apiErr.Status, "status")
	require.Equal(t, 1, h.calls, "超限的那次不该调 LLM，总调用次数")
}

// enabled=false 时草稿不限量（与 /turn 的语义一致）。
func TestDraftUnlimitedWhenQuotaDisabled(t *testing.T) {
	h := newHarness(t, validDraftPayload)
	h.setQuota(t, 5, false)

	for i := 1; i <= 3; i++ {
		_, err := h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())
		require.NoErrorf(t, err, "第 %d 次不该失败", i)
	}
}

// 上游失败 → 503，文案与 Rust 一致。
func TestDraftUpstreamFailure(t *testing.T) {
	h := newHarness(t, validDraftPayload)
	h.failures = 5
	err := apiError(t, mustErr(h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())))
	require.Equal(t, 503, err.Status, "status")
	require.Equal(t, MsgDraftUnavailable, err.Message, "message")
}

// 中文演练在阶段 7 之前不可用，草稿也拒——生成一个练不了的自定义场景
// 只会让用户更困惑。
func TestDraftRejectsChineseLanguage(t *testing.T) {
	h := newHarness(t, validDraftPayload)
	zh := model.LanguageZhCN
	req := fixtureDraftRequest()
	req.Language = &zh

	err := apiError(t, mustErr(h.service.DraftScenario(ctx(), "usr_1", req)))
	require.Equal(t, 400, err.Status, "status")
	require.Zero(t, h.calls, "不该调 LLM")
}

func TestDraftRejectsInvalidLanguage(t *testing.T) {
	h := newHarness(t, validDraftPayload)
	bad := model.Language("en-XX")
	req := fixtureDraftRequest()
	req.Language = &bad

	err := apiError(t, mustErr(h.service.DraftScenario(ctx(), "usr_1", req)))
	require.Equal(t, 400, err.Status, "status")
}

// 草稿的 system prompt 必须用**新契约的键名**——模板里写的键名就是模型会
// 吐出来的键名，留着 `locale` / `en` / `zh` 会让解析层对不上，
// 症状是「草稿永远是空的」。
func TestDraftPromptUsesNewFieldNames(t *testing.T) {
	h := newHarness(t, validDraftPayload)
	_, err := h.service.DraftScenario(ctx(), "usr_1", fixtureDraftRequest())
	require.NoError(t, err)
	prompt := h.systemPrompt(t, 0)

	for _, want := range []string{
		`"category":"interview|pitch|hard_talk|daily"`,
		`"accent":"en-US|en-GB|en-IN|en-AU|null"`,
		`"opening_line_translation":"..."`,
		`"opening_next_lines":[{"text":"...","translation":"..."}]`,
	} {
		assert.Containsf(t, prompt, want, "prompt 缺少新契约片段 %s", want)
	}
	for _, unwanted := range []string{"opening_line_zh", "persona.locale", `"en":"...","zh":"..."`, "high_stakes"} {
		assert.NotContainsf(t, prompt, unwanted, "prompt 残留旧字段名 %q", unwanted)
	}
}

// 草稿请求的 JSON 里 `language` 是可选的。
func TestDraftRequestJSONShape(t *testing.T) {
	var req model.ScenarioDraftRequest
	require.NoError(t, json.Unmarshal([]byte(`{"description":"和澳洲同事交接"}`), &req))
	require.Nil(t, req.Language, "language 期望 nil")
}
