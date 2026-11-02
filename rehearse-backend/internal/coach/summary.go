package coach

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/0x81/rehearse-backend/internal/model"
)

// 本文件是复盘（`POST /api/rehearse/summary`）。
//
// 移植自 `moyan-backend/src/services/coach.rs:209-300`，目标文件是设计稿
// §7.9 指定的 `internal/coach/summary.go`。

// MsgSummaryUnavailable 与 Rust 的文案逐字一致（`coach.rs:247`）。
const MsgSummaryUnavailable = "AI coach summary is temporarily unavailable"

// maxSummaryTokens 与 Rust 的 MAX_SUMMARY_TOKENS 一致。
const maxSummaryTokens = 3_000

// Summary 生成复盘。
//
// ⚠️ 与 `/turn` 的两处差异，都是照搬上游的，不要「顺手统一」：
//
//   - **不扣额度**：Rust 的 `summary` 里没有 `quota.check_and_consume`
//     （`coach.rs:209-258`）。复盘不是「一次演练」，计进每日轮次会让
//     「练到一半被告知没额度」变成「复盘不了」。
//   - **解析失败回 400 而不是降级**：单轮有降级路径（保留 reply、丢掉反馈），
//     复盘没有可降级的产出——一段没有结论的复盘没有意义，所以直接把
//     「模型返回了非法 JSON」当成错误。代价是客户端会看到一个 400，
//     这是上游的既有行为。
func (s *Service) Summary(ctx context.Context, req model.SummaryRequest) (model.SummaryResponse, error) {
	scenario, err := ValidateScenario(req.Scenario)
	if err != nil {
		return model.SummaryResponse{}, middleware.BadRequest(err.Error())
	}
	if err := ValidateSummaryHistory(req.History); err != nil {
		return model.SummaryResponse{}, middleware.BadRequest(err.Error())
	}
	if req.Material != nil {
		if err := ValidateMaterial(*req.Material); err != nil {
			return model.SummaryResponse{}, middleware.BadRequest(err.Error())
		}
	}
	if err := ValidateLanguageReady(summaryLanguage(scenario, req.Language)); err != nil {
		return model.SummaryResponse{}, middleware.BadRequest(err.Error())
	}

	settings, err := s.llmSettings.Resolve(ctx)
	if err != nil {
		return model.SummaryResponse{}, middleware.Repository(err)
	}
	if !settings.Configured() {
		return model.SummaryResponse{}, middleware.ServiceUnavailable(MsgAINotConfigured)
	}

	system, err := BuildSummarySystemPrompt(scenario, req.Material, summaryLanguage(scenario, req.Language))
	if err != nil {
		return model.SummaryResponse{}, middleware.BadRequest(err.Error())
	}

	// 复盘的 user message 与单轮不同：把「本次会话结束」写进最后一条，
	// 并附上场景的教学指导语与目标语言——这两条只在复盘里给。
	guidance := "none"
	if value := s.guidance(req.ScenarioID, scenario); value != nil {
		guidance = *value
	}
	transcript := fmt.Sprintf(
		"%s\n\nAdditional teaching guidance: %s\nWrite strengths/improvements/expressions in %s.",
		BuildTranscript(req.History, "(end of session)"),
		guidance,
		summaryTargetLanguage(req.Language),
	)

	raw, err := s.client.ChatJSON(ctx, settings, system, transcript, maxSummaryTokens)
	if err != nil {
		return model.SummaryResponse{}, middleware.ServiceUnavailable(MsgSummaryUnavailable)
	}

	return parseSummaryPayload(raw, summaryStats(req.History))
}

// summaryLanguage 决定 system prompt 用哪套模板。
//
// 与单轮一致：请求里的覆盖值优先，否则用场景默认语言。
func summaryLanguage(scenario model.Scenario, override *model.Language) model.Language {
	if override != nil {
		return *override
	}
	return scenario.Language
}

// summaryTargetLanguage 决定 strengths / improvements / expressions 用哪种语言写。
//
// ⚠️ 默认值是 **Chinese**，照搬 Rust 的 `req.locale.unwrap_or("zh-CN")`
// （`coach.rs:227`）。这不是笔误：复盘的读者是中文母语的学习者，
// 与 §7.6「解释语言始终是中文」是同一条理由。别顺手改成「跟随场景语言」——
// 那会让英文演练的复盘突然变成英文，而客户端没有任何地方做这个切换。
func summaryTargetLanguage(language *model.Language) string {
	if language != nil && strings.HasPrefix(string(*language), "en") {
		return "English"
	}
	return "Chinese"
}

// summaryStats 算出复盘的统计数字。
//
// 由服务端算而不是让模型报：模型数不准，而这三个数字是**可判定**的
// （§7.8 把「可判定的部分必须逐条对齐」列为验收门槛）。
func summaryStats(history []model.Turn) model.SummaryStats {
	stats := model.SummaryStats{}
	for _, turn := range history {
		if turn.Role != model.RoleUser {
			continue
		}
		stats.Turns++
		stats.UserChars += uint32(len([]rune(turn.Content)))
	}
	return stats
}

// llmSummaryPayload 是模型输出的形状。
type llmSummaryPayload struct {
	OverallZh         string                   `json:"overall_zh"`
	OverallEn         string                   `json:"overall_en"`
	Strengths         []string                 `json:"strengths"`
	Improvements      []string                 `json:"improvements"`
	Expressions       []model.Expression       `json:"expressions"`
	InterviewFeedback *model.InterviewFeedback `json:"interview_feedback"`
}

// maxSummaryItems 是 strengths / improvements / expressions 的上限（Rust `.take(3)`）。
const maxSummaryItems = 3

// parseSummaryPayload 解析模型输出并补齐统计。
//
// `corrections` 由调用方传：上游目前固定传 0（`coach.rs:257`）——单轮响应
// 里的纠错条数没有回传链路，服务端不重算。这个字段先留着，等 App 侧开始
// 累计了再填，现在它恒为 0。
func parseSummaryPayload(raw string, stats model.SummaryStats) (model.SummaryResponse, error) {
	var payload llmSummaryPayload
	if err := json.Unmarshal([]byte(StripCodeFences(raw)), &payload); err != nil {
		return model.SummaryResponse{}, middleware.BadRequest(
			fmt.Sprintf("invalid summary JSON: %v", err))
	}
	if strings.TrimSpace(payload.OverallZh) == "" && strings.TrimSpace(payload.OverallEn) == "" {
		return model.SummaryResponse{}, middleware.BadRequest("summary was empty")
	}

	feedback := payload.InterviewFeedback
	if feedback != nil && feedback.WeakSpots == nil {
		// 与 feedback.corrections 同理：nil slice 会序列化成 null。
		feedback.WeakSpots = []string{}
	}

	return model.SummaryResponse{
		OverallZh:         payload.OverallZh,
		OverallEn:         payload.OverallEn,
		Strengths:         takeAtMost(payload.Strengths, maxSummaryItems),
		Improvements:      takeAtMost(payload.Improvements, maxSummaryItems),
		Expressions:       takeExpressions(payload.Expressions, maxSummaryItems),
		Stats:             stats,
		InterviewFeedback: feedback,
	}, nil
}

// takeAtMost 返回最多 max 个元素的**非 nil** 切片。
//
// 非 nil 是契约要求：`null` 与 `[]` 在客户端是两种分支（见 normalizeFeedback）。
func takeAtMost(values []string, max int) []string {
	out := make([]string, 0, max)
	for _, value := range values {
		if len(out) == max {
			break
		}
		out = append(out, value)
	}
	return out
}

func takeExpressions(values []model.Expression, max int) []model.Expression {
	out := make([]model.Expression, 0, max)
	for _, value := range values {
		if len(out) == max {
			break
		}
		out = append(out, value)
	}
	return out
}
