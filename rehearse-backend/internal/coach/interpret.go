package coach

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/0x81/rehearse-backend/internal/llm"
	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/0x81/rehearse-backend/internal/model"
)

// 本文件是同传字幕的整句翻译（`POST /api/rehearse/interpret/translate`）。
//
// 只翻**已断句提交**的一句：流式识别中的改判、断句与增量拼接都在客户端
// （`rehearse-app/src/lib/rehearse-interpret.ts`），服务端只做无状态翻译。
// 这样服务端没有会话状态，掉线重连不会丢上下文之外的东西。

const (
	// maxTranslateChars 与 turn 的 user_text 上限同一量级：一句口语句子
	// 不可能接近这个长度，出现即视为输入异常。
	maxTranslateChars = 1_200
	// maxTranslateTokens 给译文留足空间，同时防止模型跑偏后无限输出。
	maxTranslateTokens = 800
	// MsgTranslateUnavailable 与其它 AI 端点一致：上游失败统一 503，
	// 不把底层细节透给客户端（§13）。
	MsgTranslateUnavailable = "AI translator is temporarily unavailable"
	// translateTimeout 比对话轮次的 300s 短得多。同传是连续调用，
	// 一次挂起五分钟会让客户端积压几十句，字幕直接失去意义。
	translateTimeout = 20 * time.Second
	// interpretPerMinute 是单用户每分钟的翻译调用上限。
	interpretPerMinute = 60
)

type interpretLimiter struct {
	mu      sync.Mutex
	windows map[string]interpretWindow
}

type interpretWindow struct {
	start time.Time
	count int
}

// allow 是单进程的每分钟滑窗计数。多副本部署时每个副本各自计数，
// 它是成本兜底，不是计费边界。
func (l *interpretLimiter) allow(userID string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.windows == nil {
		l.windows = make(map[string]interpretWindow)
	}
	if len(l.windows) > 1024 {
		for key, value := range l.windows {
			if now.Sub(value.start) >= time.Minute {
				delete(l.windows, key)
			}
		}
	}
	window := l.windows[userID]
	if window.start.IsZero() || now.Sub(window.start) >= time.Minute {
		window = interpretWindow{start: now}
	}
	if window.count >= interpretPerMinute {
		l.windows[userID] = window
		return false
	}
	window.count++
	l.windows[userID] = window
	return true
}

const translateSystemPrompt = `You are a professional simultaneous interpreter working for a Chinese foreign-trade team.
Translate the user's English utterance into Simplified Chinese.

Rules:
- Output JSON only, no markdown fences, matching exactly this shape: {"translation":"..."}
- Translate meaning, not words. The result must read like natural spoken Chinese.
- Keep every number, price, quantity, date, unit and Incoterm exactly as spoken
  (e.g. 3.50 USD, MOQ 5,000 pcs, FOB Shanghai, CIF, 45 days). Never round or reinterpret them.
- Preserve product models, company names and technical terms; do not invent equivalents.
- If the utterance is incomplete or unclear, translate the part that is clear and keep it short.
- Do not add explanations, notes or punctuation beyond the translation itself.`

// Translate 把一句英文口译成简体中文。
//
// 与 /turn 的差异：不扣对话额度。同传按句调用，计进对话轮次会让一次十分钟的
// 会议吃掉几十轮额度；额度模型（`quota.go`）是给对话演练设计的。
// 成本由 interpretLimiter 的每分钟上限兜底。
func (s *Service) Translate(
	ctx context.Context,
	userID string,
	req model.TranslateRequest,
) (model.TranslateResponse, error) {
	text := strings.TrimSpace(req.Text)
	if text == "" {
		return model.TranslateResponse{}, middleware.BadRequest("text must not be empty")
	}
	if utf8.RuneCountInString(text) > maxTranslateChars {
		return model.TranslateResponse{}, middleware.BadRequest(
			fmt.Sprintf("text must be at most %d characters", maxTranslateChars))
	}

	settings, err := s.llmSettings.Resolve(ctx)
	if err != nil {
		return model.TranslateResponse{}, middleware.Repository(err)
	}
	if !settings.Configured() {
		return model.TranslateResponse{}, middleware.ServiceUnavailable(MsgAINotConfigured)
	}
	if !s.interpret.allow(userID, time.Now()) {
		return model.TranslateResponse{}, middleware.TooManyRequests(
			"Too many translation requests", "interpret_rate_limited")
	}

	ctx, cancel := context.WithTimeout(ctx, translateTimeout)
	defer cancel()
	raw, err := s.client.ChatJSON(ctx, settings, translateSystemPrompt, text, maxTranslateTokens)
	if err != nil {
		return model.TranslateResponse{}, translateUpstreamError(err)
	}

	translation, err := parseTranslation(raw)
	if err != nil {
		return model.TranslateResponse{}, middleware.ServiceUnavailable(MsgTranslateUnavailable)
	}
	return model.TranslateResponse{Translation: translation}, nil
}

func translateUpstreamError(err error) error {
	if errors.Is(err, llm.ErrNotConfigured) {
		return middleware.ServiceUnavailable(MsgAINotConfigured)
	}
	return middleware.ServiceUnavailable(MsgTranslateUnavailable)
}

// parseTranslation 解析模型输出。
//
// 与 turn 的降级不同，这里解析失败**不兜底原文**：字幕里混进一段 JSON
// 或英文原文，比短暂显示「翻译中…」更糟。客户端会把这一句标记为翻译失败，
// 原文仍然保留在屏幕上。
func parseTranslation(raw string) (string, error) {
	var payload struct {
		Translation string `json:"translation"`
	}
	if err := json.Unmarshal([]byte(StripCodeFences(raw)), &payload); err != nil {
		return "", err
	}
	translation := strings.TrimSpace(payload.Translation)
	if translation == "" {
		return "", errors.New("empty translation")
	}
	return translation, nil
}
