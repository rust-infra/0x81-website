package material

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/0x81/rehearse-backend/internal/llm"
	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/0x81/rehearse-backend/internal/model"
)

// 本文件是「用户确认过的材料文本 → 紧凑面试档案」。
//
// 移植自 `moyan-backend/src/services/interview_profile.rs`（152 行）。
// 只接受文本：图片与原文在 Task 13 之后就不再参与。档案是后续 `/turn` 与
// `/summary` 唯一携带的材料内容。

// MaxTextChars 是档案输入的字符上限（interview_profile.rs:14）。
const MaxTextChars = 20_000

// MaxProfileTokens 是档案生成的输出 token 上限（interview_profile.rs:15）。
const MaxProfileTokens = 1_600

// resumePrompt / jobPrompt 与 Rust 的 RESUME_PROMPT / JOB_PROMPT 逐字一致
// （interview_profile.rs:17-27）。prompt 是契约的一部分，不做润色。
const resumePrompt = `You extract hiring-focused profiles from resumes. Return JSON only: {"profile":"..."}
Cover: years and domain, core tech stack, 2-3 notable projects with concrete outcomes, and 3 likely interview follow-up angles. Under 800 characters, Simplified Chinese. Never invent facts that are not in the text.`

const jobPrompt = `You extract hiring-focused profiles from job postings. Return JSON only: {"profile":"..."}
Cover: role and seniority, must-have skills, nice-to-have skills, and the 3 capabilities the interview will most likely probe. Under 600 characters, Simplified Chinese. Never invent requirements that are not in the text.`

// msgProfileUnavailable 是档案上游失败时的固定文案。
//
// 与 vision.go 的 msgOCRUnavailable 同一条理由：**有意的偏离**——Rust 把上游
// 失败统一压成一句 503（interview_profile.rs:66-70），这里沿用它的做法，
// 且不再附加任何上游细节（上游错误体永不下发，§13）。
const msgProfileUnavailable = "AI profile extraction is temporarily unavailable"

// ProfileService 把材料文本压缩成面试档案。
type ProfileService struct {
	quota    QuotaConsumer
	settings LLMSettingsResolver
	client   *llm.Client
}

// NewProfileService 组装档案服务。
func NewProfileService(quota QuotaConsumer, settings LLMSettingsResolver, client *llm.Client) *ProfileService {
	return &ProfileService{quota: quota, settings: settings, client: client}
}

// Profile 生成档案。
//
// ⚠️ 调用顺序与 OCR / coach.Turn 一致，不要重排（interview_profile.rs:48-51）：
// 校验 → 解析配置 → 未配置先 503 → 扣额度 → 调 LLM。校验失败或未配置时
// **不扣额度**：用户没做错任何事，不该损失一次额度。
func (s *ProfileService) Profile(
	ctx context.Context, userID string, req model.MaterialProfileRequest,
) (model.MaterialProfileResponse, error) {
	if err := validateProfileRequest(req); err != nil {
		return model.MaterialProfileResponse{}, err
	}

	settings, err := s.settings.Resolve(ctx)
	if err != nil {
		return model.MaterialProfileResponse{}, middleware.Repository(err)
	}
	if !settings.Configured() {
		return model.MaterialProfileResponse{}, middleware.ServiceUnavailable(msgAINotConfigured)
	}

	if err := s.quota.CheckAndConsume(ctx, userID); err != nil {
		return model.MaterialProfileResponse{}, err
	}

	// Rust 里 kind != "job" 就走 resume（interview_profile.rs:53-57）；kind
	// 已经过校验，只可能是 resume / job，所以这里的二分是穷尽的。
	system := resumePrompt
	if req.Kind == "job" {
		system = jobPrompt
	}

	raw, err := s.client.ChatJSON(ctx, settings, system, strings.TrimSpace(req.Text), MaxProfileTokens)
	if err != nil {
		return model.MaterialProfileResponse{}, middleware.ServiceUnavailable(msgProfileUnavailable)
	}

	profile, err := parseProfilePayload(raw)
	if err != nil {
		return model.MaterialProfileResponse{}, err
	}
	return model.MaterialProfileResponse{Kind: req.Kind, Profile: profile}, nil
}

// validateProfileRequest 校验档案请求（interview_profile.rs:79-95）。
//
// ⚠️ 长度按**字符数**算，且用的是**未 trim** 的原文——Rust 同样是
// `req.text.chars().count()`。两者都照搬，免得边界行为和 Rust 不一致。
func validateProfileRequest(req model.MaterialProfileRequest) error {
	if !slices.Contains(model.MaterialProfileKinds, req.Kind) {
		return middleware.BadRequest("kind must be resume or job")
	}
	if strings.TrimSpace(req.Text) == "" {
		return middleware.BadRequest("text is required")
	}
	if countRunes(req.Text) > MaxTextChars {
		// 用常量拼文案，改上限时错误信息自动跟着变，不会两处漂移。
		return middleware.BadRequest(fmt.Sprintf("text must be at most %d characters", MaxTextChars))
	}
	return nil
}

// llmProfilePayload 是模型输出的形状：`{"profile":"..."}`。
type llmProfilePayload struct {
	Profile string `json:"profile"`
}

// parseProfilePayload 解析档案 JSON 输出（interview_profile.rs:102-111）。
//
// 与 OCR 一样：先去掉 markdown 围栏（模型不总听话），再解 JSON；profile
// trim 后为空视为失败。两者都是 400。
func parseProfilePayload(raw string) (string, error) {
	var payload llmProfilePayload
	if err := json.Unmarshal([]byte(stripCodeFences(raw)), &payload); err != nil {
		return "", middleware.BadRequest("invalid profile JSON: " + err.Error())
	}
	profile := strings.TrimSpace(payload.Profile)
	if profile == "" {
		return "", middleware.BadRequest("profile was empty")
	}
	return profile, nil
}
