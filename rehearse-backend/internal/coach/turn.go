package coach

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/0x81/rehearse-backend/internal/llm"
	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/0x81/rehearse-backend/internal/model"
	"github.com/0x81/rehearse-backend/internal/scenarios"
)

// 本文件是「一轮对话」（`POST /api/rehearse/turn`）。
//
// 移植自 `moyan-backend/src/services/coach.rs:40-120`，目标文件是设计稿
// §7.9 指定的 `internal/coach/turn.go`。

// Service 是演练编排：一轮对话、复盘、场景草稿共用它。
type Service struct {
	quota       *QuotaService
	llmSettings *LLMSettingsService
	catalog     *scenarios.Catalog
	client      *llm.Client
}

// NewService 组装演练编排。
func NewService(
	quota *QuotaService,
	llmSettings *LLMSettingsService,
	catalog *scenarios.Catalog,
	client *llm.Client,
) *Service {
	return &Service{quota: quota, llmSettings: llmSettings, catalog: catalog, client: client}
}

// Turn 跑一轮对话。
//
// ⚠️ 调用顺序是护栏的一部分，不要重排：
//
//  1. 结构校验（场景 / 历史 / 轮次 / 材料）——**在**任何外部调用之前，
//     这样超长或非法的输入不会产生 LLM 请求，也不会扣额度
//  2. `ensure_configured`——服务没配好时**先**返回 503，
//     否则用户会白掉一次额度且拿不到任何结果（Rust `coach.rs:57-61`）
//  3. 扣额度——超限直接 429，同样不产生 LLM 请求
//  4. 构造 prompt + 调 LLM（失败重试一次）
func (s *Service) Turn(ctx context.Context, userID string, req model.TurnRequest) (model.TurnResponse, error) {
	scenario, err := ValidateScenario(req.Scenario)
	if err != nil {
		return model.TurnResponse{}, middleware.BadRequest(err.Error())
	}
	if err := ValidateHistory(req.History, req.UserText); err != nil {
		return model.TurnResponse{}, middleware.BadRequest(err.Error())
	}
	turnIndex, err := NextTurnIndex(req.History, req.CompletedTurns, scenario.MaxTurns)
	if err != nil {
		return model.TurnResponse{}, middleware.BadRequest(err.Error())
	}
	if req.Material != nil {
		if err := ValidateMaterial(*req.Material); err != nil {
			return model.TurnResponse{}, middleware.BadRequest(err.Error())
		}
	}
	mode, err := resolveMode(req.Mode)
	if err != nil {
		return model.TurnResponse{}, err
	}
	language, err := resolveLanguage(scenario, req.Language)
	if err != nil {
		return model.TurnResponse{}, err
	}
	if err := ValidateLanguageReady(language); err != nil {
		return model.TurnResponse{}, middleware.BadRequest(err.Error())
	}

	settings, err := s.llmSettings.Resolve(ctx)
	if err != nil {
		return model.TurnResponse{}, middleware.Repository(err)
	}
	if !settings.Configured() {
		return model.TurnResponse{}, middleware.ServiceUnavailable(MsgAINotConfigured)
	}

	if err := s.quota.CheckAndConsume(ctx, userID); err != nil {
		return model.TurnResponse{}, err
	}

	system, err := BuildSystemPrompt(scenario, s.guidance(req.ScenarioID, scenario), req.Material, language)
	if err != nil {
		// 走到这里只可能是中文演练（阶段 7 未做）或未知语言——两者都是客户端
		// 可以修正的输入问题，不是服务故障。
		return model.TurnResponse{}, middleware.BadRequest(err.Error())
	}
	transcript := BuildTranscript(req.History, req.UserText)

	raw, err := s.client.ChatJSON(ctx, settings, system, transcript, MaxTurnTokens)
	if err != nil {
		// 上游偶发失败：重试一次。Rust 同样只重试一次（`coach.rs:85-95`）——
		// 再多会把这个请求的耗时堆到客户端超时。
		raw, err = s.client.ChatJSON(ctx, settings, system, transcript, MaxTurnTokens)
	}

	// limit_reached 在 LLM 调用**之后**算，与 Rust 一致（`coach.rs:97`）。
	limitReached := turnIndex >= scenario.MaxTurns

	if err != nil {
		// 只回一句固定文案：上游错误里可能有账号标识、配额信息（§13）。
		return model.TurnResponse{}, middleware.ServiceUnavailable(MsgCoachUnavailable)
	}

	parsed, parseErr := parseTurnPayload(raw)
	if parseErr != nil {
		// ⚠️ 刻意不报错：模型偶尔吐出不合法 JSON，把它当服务故障会让用户
		// 看到错误页，而实际上对话还能继续。退化成「只有 reply、没有反馈」。
		return DegradedResponse(raw, turnIndex, limitReached), nil
	}
	if mode == model.ModeImmersion {
		// 沉浸模式只聊天、不逐轮纠错（§7.6 的 mode 语义）。
		parsed.Feedback = nil
	}
	// 这里传 feedback：推荐表达不能和纠错里的原句/改句/更地道的说法重复。
	parsed.NextLines = SanitizeNextLines(parsed.NextLines, parsed.Feedback, parsed.Reply)
	parsed.TurnIndex = turnIndex
	parsed.LimitReached = limitReached
	return parsed, nil
}

// guidance 取 preset 场景的服务端指导语。
//
// 两个条件都要满足：客户端声明了 `scenario_id`，且场景是 preset。
// 自定义场景没有 guidance——它是用户自己的数据，服务端没有对应的教学意图
// （§4.4）。注意这里的取值来源是**服务端目录**，不是请求体里的任何字段。
func (s *Service) guidance(scenarioID *string, scenario model.Scenario) *string {
	if scenarioID == nil || scenario.Source != model.SourcePreset {
		return nil
	}
	guidance, ok := s.catalog.Guidance(*scenarioID)
	if !ok || strings.TrimSpace(guidance) == "" {
		return nil
	}
	return &guidance
}

// resolveMode 补上 `mode` 的默认值并校验。
//
// ⚠️ 两个都是必需的处理，不能省：
//
//   - **默认值**：Rust 的 `CoachMode` 有 `#[derive(Default)]` 且 `#[serde(default)]`，
//     客户端不发 `mode` 时是 `feedback`。Go 的字符串零值是 `""`，
//     不补的话沉浸模式判断会静默失效（`"" != immersion` → 永远当反馈模式）。
//   - **校验**：Rust 侧非法枚举值在反序列化阶段就被拒（axum 回 422）。
//     Go 的 `json.Unmarshal` 对字符串类型照单全收，不校验就会一路走下去。
func resolveMode(raw model.Mode) (model.Mode, error) {
	if raw == "" {
		return model.ModeFeedback, nil
	}
	if !raw.Valid() {
		return "", middleware.BadRequest("mode must be one of feedback, immersion")
	}
	return raw, nil
}

// resolveLanguage 解析本次演练的语言：请求里的覆盖值优先，否则用场景默认值。
func resolveLanguage(scenario model.Scenario, override *model.Language) (model.Language, error) {
	language := scenario.Language
	if override != nil {
		language = *override
	}
	if !language.Valid() {
		return "", middleware.BadRequest("language must be one of " + joinLanguages())
	}
	return language, nil
}

// llmTurnPayload 是模型输出的形状（§7.6 的新字段名）。
type llmTurnPayload struct {
	Reply            string             `json:"reply"`
	ReplyTranslation *string            `json:"reply_translation"`
	Mood             *string            `json:"mood"`
	Feedback         *model.Feedback    `json:"feedback"`
	NextLines        []model.Expression `json:"next_lines"`
}

// parseTurnPayload 解析模型输出。
//
// ⚠️ 与 Rust 的一处**有意差异**：Rust 在 `parse_turn_payload` 里先按
// `feedback=None` 过滤一遍 next_lines，服务层拿到结果后再按真实 feedback
// 过滤第二遍（`coach.rs:105-109`）。两遍串联会因为「第一遍的 2 条上限」
// 提前砍掉候选，导致本可保留的第三条被丢掉。这里只过滤一次，且带着完整的
// feedback——过滤规则（去空、去重、去与 reply/纠错重复、上限 2）一条不少，
// 只是不再出现那个提前截断。
//
// `next_lines` 在这里**不过滤**，由调用方带着 feedback 统一过滤。
func parseTurnPayload(raw string) (model.TurnResponse, error) {
	var payload llmTurnPayload
	if err := json.Unmarshal([]byte(StripCodeFences(raw)), &payload); err != nil {
		return model.TurnResponse{}, err
	}

	reply := TrimReply(payload.Reply)
	if reply == "" {
		return model.TurnResponse{}, errEmptyReply
	}

	mood := model.MoodNeutral
	if payload.Mood != nil {
		if candidate := model.Mood(strings.ToLower(strings.TrimSpace(*payload.Mood))); candidate.Valid() {
			mood = candidate
		}
	}

	return model.TurnResponse{
		Reply:            reply,
		ReplyTranslation: trimOptional(payload.ReplyTranslation),
		Mood:             mood,
		Feedback:         normalizeFeedback(payload.Feedback),
		NextLines:        payload.NextLines,
	}, nil
}

// normalizeFeedback 让嵌套切片**不是 nil**。
//
// ⚠️ 这条是线上契约，不是洁癖：Go 的 nil slice 序列化成 `null`，而 Rust 的
// `Vec` 序列化成 `[]`。App 端写的是 `feedback.corrections.map(...)`——
// 拿到 `null` 会直接崩，而两边都是 200，看不出哪里不对。
func normalizeFeedback(feedback *model.Feedback) *model.Feedback {
	if feedback == nil {
		return nil
	}
	if feedback.Corrections == nil {
		feedback.Corrections = []model.Correction{}
	}
	if feedback.Expressions == nil {
		feedback.Expressions = []model.Expression{}
	}
	return feedback
}

// trimOptional 把「给了但全是空白」的字符串折叠成 nil。
//
// 契约上 `reply_translation` 是「可空」，空白串没有意义，统一成 null
// 免得客户端既要判空串又要判 null。
func trimOptional(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// errEmptyReply 表示模型返回了 JSON 但 reply 为空——按 Rust 的处理算解析失败，
// 走降级响应（把原文当回复）。
var errEmptyReply = errors.New("coach reply was empty")

// 服务级固定文案。与 Rust 逐字一致，客户端可能按文案做本地化。
const (
	MsgAINotConfigured  = "AI service is not configured"
	MsgCoachUnavailable = "AI coach is temporarily unavailable"
)
