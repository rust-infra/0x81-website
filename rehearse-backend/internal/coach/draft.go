package coach

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/0x81/rehearse-backend/internal/model"
)

// 本文件是场景草稿（`POST /api/rehearse/scenario/draft`）。
//
// 移植自 `moyan-backend/src/services/coach.rs:302-420`，目标文件是设计稿
// §7.9 指定的 `internal/coach/draft.go`。

// MsgDraftUnavailable 与 Rust 的文案逐字一致（`coach.rs:340`）。
const MsgDraftUnavailable = "AI scenario drafting is temporarily unavailable"

// 草稿相关的上限，与 Rust 一致（`coach.rs:328-337、375-377`）。
const (
	maxDraftDescriptionChars = 200
	maxDraftTokens           = 1_100
	// maxOpeningSuggestionChars 是单条开场推荐语的字符上限：它要能塞进聊天里
	// 的一张小卡片，不能是一段话。超长的整条丢掉。
	maxOpeningSuggestionChars = 160
	// maxOpeningSuggestions 与前端 `filterNextLines` 的上限一致：只展示两条。
	maxOpeningSuggestions = 2
)

// DraftScenario 用一段中文描述生成自定义场景。
//
// 顺序与 Rust 一致：**先**扣额度，**再**调 LLM（`coach.rs:333-337`）。
// 这与 `/turn` 的「先 ensure_configured 再扣额度」并不矛盾——两处都是
// 「确认这一次调用真的会发生」之后才扣，区别只在于草稿没有降级路径，
// 上游失败就是失败，额度已经花掉了（上游的既有行为）。
func (s *Service) DraftScenario(
	ctx context.Context, userID string, req model.ScenarioDraftRequest,
) (model.Scenario, error) {
	description := strings.TrimSpace(req.Description)
	if description == "" {
		return model.Scenario{}, middleware.BadRequest("description is required")
	}
	if countRunes(description) > maxDraftDescriptionChars {
		return model.Scenario{}, middleware.BadRequest(
			fmt.Sprintf("description must be at most %d characters", maxDraftDescriptionChars))
	}

	language := model.LanguageEnUS
	if req.Language != nil {
		language = *req.Language
	}
	if !language.Valid() {
		return model.Scenario{}, middleware.BadRequest("language must be one of " + joinLanguages())
	}
	if err := ValidateLanguageReady(language); err != nil {
		// 草稿同样拒中文：生成一个演练不了的自定义场景，用户只会更困惑。
		return model.Scenario{}, middleware.BadRequest(err.Error())
	}

	settings, err := s.llmSettings.Resolve(ctx)
	if err != nil {
		return model.Scenario{}, middleware.Repository(err)
	}
	if !settings.Configured() {
		return model.Scenario{}, middleware.ServiceUnavailable(MsgAINotConfigured)
	}

	if err := s.quota.CheckAndConsume(ctx, userID); err != nil {
		return model.Scenario{}, err
	}

	raw, err := s.client.ChatJSON(ctx, settings, draftSystemPrompt, description, maxDraftTokens)
	if err != nil {
		return model.Scenario{}, middleware.ServiceUnavailable(MsgDraftUnavailable)
	}

	id, err := newCustomScenarioID()
	if err != nil {
		return model.Scenario{}, middleware.Internal(err)
	}
	return parseDraftPayload(raw, id, language)
}

// newCustomScenarioID 生成 `custom_<32 位十六进制>`。
//
// 形状对齐 Rust 的 `format!("custom_{}", Uuid::new_v4().simple())`：v4 UUID
// 的无连字符形式。用标准库拼而不是引一个 uuid 依赖——为了 32 个十六进制
// 字符加一个第三方包不值得，而 v4 的版本位与变体位各一行就能设对。
func newCustomScenarioID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("generate scenario id: %w", err)
	}
	raw[6] = (raw[6] & 0x0f) | 0x40 // version 4
	raw[8] = (raw[8] & 0x3f) | 0x80 // variant RFC 4122
	return "custom_" + hex.EncodeToString(raw[:]), nil
}

// llmDraftPayload 是模型输出的形状（§7.6 的新字段名）。
type llmDraftPayload struct {
	Category               model.Category     `json:"category"`
	Title                  string             `json:"title"`
	Description            string             `json:"description"`
	Persona                model.Persona      `json:"persona"`
	Setting                string             `json:"setting"`
	OpeningLine            string             `json:"opening_line"`
	OpeningLineTranslation *string            `json:"opening_line_translation"`
	OpeningNextLines       []model.Expression `json:"opening_next_lines"`
	FocusPoints            []string           `json:"focus_points"`
	Difficulty             string             `json:"difficulty"`
	MaxTurns               uint32             `json:"max_turns"`
}

// parseDraftPayload 解析模型输出，强制成 custom 场景，并跑一遍完整校验。
//
// ⚠️ 最后那句 `ValidateScenario` 是必需的：模型可以返回任何东西，
// 而这份草稿会被客户端存下来、之后当作 `scenario` 原样发回 `/turn`。
// 在这里挡住，等于把「用户存了一个永远用不了的自定义场景」变成
// 「这次生成失败，重试一次」。
func parseDraftPayload(raw, id string, language model.Language) (model.Scenario, error) {
	var payload llmDraftPayload
	if err := json.Unmarshal([]byte(StripCodeFences(raw)), &payload); err != nil {
		return model.Scenario{}, middleware.BadRequest(
			fmt.Sprintf("invalid scenario draft JSON: %v", err))
	}

	translation := ""
	if payload.OpeningLineTranslation != nil {
		translation = strings.TrimSpace(*payload.OpeningLineTranslation)
	}

	scenario := model.Scenario{
		ID:       id,
		Source:   model.SourceCustom,
		Category: payload.Category,
		Language: language,
		Title:    payload.Title,
		// 注意：标题/描述来自模型，属于**内容**不是指令——它们只会在
		// `[BEGIN SCENARIO DATA]` 数据块里出现（见 prompts.go 的转义）。
		Description:            payload.Description,
		Persona:                payload.Persona,
		Setting:                payload.Setting,
		OpeningLine:            payload.OpeningLine,
		OpeningLineTranslation: translation,
		// 开场白配套的推荐语跟草稿一起生成：用户的第一句最容易卡住，
		// 不能等到「第一次 AI 回复」才给提示——那要等用户先开口。
		OpeningNextLines: sanitizeOpeningNextLines(payload.OpeningNextLines),
		FocusPoints:      nonNilStrings(payload.FocusPoints),
		Difficulty:       payload.Difficulty,
		MaxTurns:         payload.MaxTurns,
	}

	validated, err := ValidateScenario(scenario)
	if err != nil {
		return model.Scenario{}, middleware.BadRequest(err.Error())
	}
	return validated, nil
}

// sanitizeOpeningNextLines 丢掉空行与超长行，最多留两条。
//
// 与 Rust 的 `sanitize_opening_next_lines`（`coach.rs:380-395`）一致：只看
// **原文**（`text`）——超长判断针对学习者的目标语言，翻译跟着走。
func sanitizeOpeningNextLines(lines []model.Expression) []model.Expression {
	out := make([]model.Expression, 0, maxOpeningSuggestions)
	for _, line := range lines {
		text := strings.TrimSpace(line.Text)
		if text == "" || countRunes(text) > maxOpeningSuggestionChars {
			continue
		}
		out = append(out, model.Expression{
			Text:        text,
			Translation: strings.TrimSpace(line.Translation),
		})
		if len(out) == maxOpeningSuggestions {
			break
		}
	}
	return out
}

// nonNilStrings 保证空列表序列化成 `[]` 而不是 `null`（同 normalizeFeedback）。
func nonNilStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}
