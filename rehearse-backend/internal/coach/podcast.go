package coach

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/0x81/rehearse-backend/internal/llm"
	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/0x81/rehearse-backend/internal/store"
)

// 本文件是播客台词的**离线整集翻译**。
//
// 与 `interpret.go`（同传字幕的逐句实时翻译）的区别是这次改造的全部要点：
//
//   · 逐句实时翻，模型每次只看到一句话，看不到谁在对谁说、上下文是什么。
//     同一个 "Thank you." 在面试里和在闲聊里该译得不一样，逐句调用无从判断。
//   · 整集一次请求，模型看得到完整对话，术语、称呼、语气能前后一致。
//   · 结果落库（`rehearse_podcast_translations`），播放时只读库，不再调 LLM。
//     台词是固定的本地课程数据，一集译一次就够；播放时再调既费额度，
//     又会让字幕随网络逐句迟到。
//
// `interpret.go` 的实时路径保留：同传页（用户现场说话）确实需要逐句。
// 播客不再走它。

const (
	// maxPodcastTurns 一集最多多少句。本地课程数据最多十来句，
	// 上限是防「客户端塞一整个会话进来」这条成本路径。
	maxPodcastTurns = 200
	// maxPodcastTurnChars 单句上限，与同传一致。
	maxPodcastTurnChars = 1200
	// maxPodcastEpisodeChars 整集上限。整集一次请求，所以要有总量护栏。
	maxPodcastEpisodeChars = 20000
	// maxPodcastTokens 给译文留足空间。整集输出比单句长得多。
	maxPodcastTokens = 8000
	// podcastEpisodePerMinute 单用户每分钟的整集生成上限。
	// 整集生成是重操作（一次大请求），比同传的 60 次/分钟严得多。
	podcastEpisodePerMinute = 6
)

// PodcastTranslationRequest 是一集台词的翻译请求。
//
// `source_hash` 由客户端计算（对台词内容做指纹）。服务端**不**自己算：
// 客户端才是「哪些台词属于这一集、第几句」的真相源，服务端只按它给的
// 指纹存与查。改台词 → 指纹变 → 旧译文整体作废。
type PodcastTranslation struct {
	TurnIndex   int    `json:"turn_index"`
	Speaker     string `json:"speaker"`
	SourceText  string `json:"source_text"`
	Translation string `json:"translation"`
}

// PodcastTranslationsRequest 是 `POST /api/rehearse/podcast/translations` 的请求体。
type PodcastTranslationsRequest struct {
	EpisodeID  string `json:"episode_id"`
	SourceHash string `json:"source_hash"`
	Title      string `json:"title,omitempty"`
	Turns      []struct {
		Speaker string `json:"speaker"`
		Text    string `json:"text"`
	} `json:"turns"`
}

// PodcastTranslationsResponse 是整集译文。
type PodcastTranslationsResponse struct {
	EpisodeID    string                `json:"episode_id"`
	SourceHash   string                `json:"source_hash"`
	Translations []PodcastTranslation  `json:"translations"`
	Cached       bool                  `json:"cached"`
}

// PodcastCaptionService 负责播客台词的生成与读取。
//
// 单独一个服务而不是塞进 `Service`：它需要 store（译文是持久化的），
// 而 `Service` 刻意不碰库（只走 quota / settings 两个专门的服务）。
// 把 store 塞进 `Service` 会让每个对话路径都拿着一个能读写译文的句柄。
type PodcastCaptionService struct {
	llmSettings *LLMSettingsService
	client      *llm.Client
	store       store.Store
	limiter     *interpretLimiter
	perMinute   int
}

// NewPodcastCaptionService 组装播客字幕服务。
func NewPodcastCaptionService(
	llmSettings *LLMSettingsService,
	client *llm.Client,
	st store.Store,
) *PodcastCaptionService {
	return &PodcastCaptionService{
		llmSettings: llmSettings,
		client:      client,
		store:       st,
		limiter:     &interpretLimiter{},
		perMinute:   podcastEpisodePerMinute,
	}
}

// Stored 只读已存的译文，绝不调 LLM。播放器走这条。
//
// 返回空切片表示「还没生成」，不是错误。播放器据此显示「字幕待生成」，
// 而不是在播放时偷偷补翻——那正是这次要消灭的行为。
func (s *PodcastCaptionService) Stored(
	ctx context.Context, req PodcastTranslationsRequest,
) (PodcastTranslationsResponse, error) {
	episodeID, sourceHash, err := validatePodcastKey(req)
	if err != nil {
		return PodcastTranslationsResponse{}, err
	}
	rows, err := s.store.PodcastTranslationsGet(ctx, episodeID, sourceHash)
	if err != nil {
		return PodcastTranslationsResponse{}, middleware.Repository(err)
	}
	return PodcastTranslationsResponse{
		EpisodeID:    episodeID,
		SourceHash:   sourceHash,
		Translations: toModel(rows),
		Cached:       true,
	}, nil
}

// Generate 生成整集译文。已缓存时直接返回，不重复调 LLM。
//
// 幂等：同一集、同一指纹重复调用只会在第一次真正生成。
// 这让「预生成」可以被多点触发（打开 App、进入列表、手动点一次）而不会重复花钱。
func (s *PodcastCaptionService) Generate(
	ctx context.Context, userID string, req PodcastTranslationsRequest,
) (PodcastTranslationsResponse, error) {
	episodeID, sourceHash, err := validatePodcastKey(req)
	if err != nil {
		return PodcastTranslationsResponse{}, err
	}
	turns, err := validatePodcastTurns(req)
	if err != nil {
		return PodcastTranslationsResponse{}, err
	}

	stored, err := s.store.PodcastTranslationsGet(ctx, episodeID, sourceHash)
	if err != nil {
		return PodcastTranslationsResponse{}, middleware.Repository(err)
	}
	if complete(stored, len(turns)) {
		return PodcastTranslationsResponse{
			EpisodeID:    episodeID,
			SourceHash:   sourceHash,
			Translations: toModel(stored),
			Cached:       true,
		}, nil
	}

	settings, err := s.llmSettings.Resolve(ctx)
	if err != nil {
		return PodcastTranslationsResponse{}, middleware.Repository(err)
	}
	if !settings.Configured() {
		return PodcastTranslationsResponse{}, middleware.ServiceUnavailable(MsgAINotConfigured)
	}
	if !s.limiter.allowWith(userID, s.perMinute, time.Now()) {
		return PodcastTranslationsResponse{}, middleware.TooManyRequests(
			"Too many caption generation requests", "podcast_translate_rate_limited")
	}

	translated, err := s.translateEpisode(ctx, settings, req.Title, turns)
	if err != nil {
		return PodcastTranslationsResponse{}, err
	}

	rows := make([]store.PodcastTranslation, len(turns))
	for index, turn := range turns {
		rows[index] = store.PodcastTranslation{
			TurnIndex:   index,
			SourceHash:  sourceHash,
			Speaker:     turn.Speaker,
			SourceText:  turn.Text,
			Translation: translated[index],
		}
	}
	if err := s.store.PodcastTranslationsPutReplace(ctx, episodeID, rows); err != nil {
		return PodcastTranslationsResponse{}, middleware.Repository(err)
	}
	return PodcastTranslationsResponse{
		EpisodeID:    episodeID,
		SourceHash:   sourceHash,
		Translations: toModel(rows),
		Cached:       false,
	}, nil
}

type podcastTurn struct {
	Speaker string
	Text    string
}

const podcastCaptionSystemPrompt = `You translate an English business-English podcast episode into Simplified Chinese subtitles for Chinese learners.

You receive the ENTIRE episode dialogue in order. Translate each line into natural spoken Simplified Chinese.

Rules:
- Return JSON only, no markdown fences, exactly this shape:
  {"translations":[{"turn_index":0,"translation":"..."}]}
- Include every input turn_index exactly once. Never merge, split, skip or reorder lines.
- Translate with the whole conversation in view: keep names, roles and forms of address consistent across lines, and let each line read as a reply to the one before it.
- Keep job titles, product names, technical terms and acronyms that Chinese learners already know in English (for example API, Teams, KPI). Translate ordinary business English into Chinese.
- Preserve every number, time, date and quantity exactly as spoken.
- Do not add explanations, notes, stage directions or punctuation beyond the translation itself.`

// translateEpisode 用一次请求翻完整集。
//
// 一次请求而不是逐句：上下文一致性的收益全部来自「模型同时看到所有句子」。
// 逐句并发（3 个 worker）看着快，但每句都独立判断，称呼与术语会对不齐——
// 这正是改造前播客字幕读起来别扭的原因。
func (s *PodcastCaptionService) translateEpisode(
	ctx context.Context,
	settings llm.Settings,
	title string,
	turns []podcastTurn,
) ([]string, error) {
	payload := make([]map[string]any, len(turns))
	for index, turn := range turns {
		payload[index] = map[string]any{
			"turn_index": index,
			"speaker":    turn.Speaker,
			"text":       turn.Text,
		}
	}
	userMessage, err := json.Marshal(map[string]any{
		"episode_title": title,
		"turns":         payload,
	})
	if err != nil {
		return nil, middleware.Internal(fmt.Errorf("marshal episode: %w", err))
	}

	raw, err := s.client.ChatJSON(
		ctx, settings, podcastCaptionSystemPrompt, string(userMessage), maxPodcastTokens)
	if err != nil {
		return nil, translateUpstreamError(err)
	}

	out, err := parseEpisodeTranslations(raw, len(turns))
	if err != nil {
		// 与逐句翻译同样的取舍：解析失败不兜底原文，也不写半成品进库。
		// 库里只放完整、自洽的一整集。
		return nil, middleware.ServiceUnavailable(MsgTranslateUnavailable)
	}
	return out, nil
}

func parseEpisodeTranslations(raw string, want int) ([]string, error) {
	var payload struct {
		Translations []struct {
			TurnIndex   *int   `json:"turn_index"`
			Translation string `json:"translation"`
		} `json:"translations"`
	}
	if err := json.Unmarshal([]byte(StripCodeFences(raw)), &payload); err != nil {
		return nil, err
	}
	if len(payload.Translations) != want {
		return nil, fmt.Errorf("expected %d translations, got %d", want, len(payload.Translations))
	}
	out := make([]string, want)
	seen := make([]bool, want)
	for _, item := range payload.Translations {
		if item.TurnIndex == nil {
			return nil, errors.New("missing turn_index")
		}
		index := *item.TurnIndex
		if index < 0 || index >= want {
			return nil, fmt.Errorf("turn_index out of range: %d", index)
		}
		if seen[index] {
			return nil, fmt.Errorf("duplicate turn_index: %d", index)
		}
		text := strings.TrimSpace(item.Translation)
		if text == "" {
			return nil, fmt.Errorf("empty translation at %d", index)
		}
		seen[index] = true
		out[index] = text
	}
	return out, nil
}

func validatePodcastKey(req PodcastTranslationsRequest) (string, string, error) {
	episodeID := strings.TrimSpace(req.EpisodeID)
	if episodeID == "" {
		return "", "", middleware.BadRequest("episode_id is required")
	}
	if err := checkLen("episode_id", episodeID, 128); err != nil {
		return "", "", middleware.BadRequest(err.Error())
	}
	sourceHash := strings.TrimSpace(req.SourceHash)
	if sourceHash == "" {
		return "", "", middleware.BadRequest("source_hash is required")
	}
	if len(sourceHash) != 64 || !isLowerHex(sourceHash) {
		return "", "", middleware.BadRequest("source_hash must be a sha256 hex digest")
	}
	return episodeID, sourceHash, nil
}

func validatePodcastTurns(req PodcastTranslationsRequest) ([]podcastTurn, error) {
	if len(req.Turns) == 0 {
		return nil, middleware.BadRequest("turns must not be empty")
	}
	if len(req.Turns) > maxPodcastTurns {
		return nil, middleware.BadRequest(fmt.Sprintf("turns must be at most %d", maxPodcastTurns))
	}
	out := make([]podcastTurn, len(req.Turns))
	total := 0
	for index, turn := range req.Turns {
		text := strings.TrimSpace(turn.Text)
		if text == "" {
			return nil, middleware.BadRequest(fmt.Sprintf("turns[%d].text is required", index))
		}
		if err := checkLen(fmt.Sprintf("turns[%d].text", index), text, maxPodcastTurnChars); err != nil {
			return nil, middleware.BadRequest(err.Error())
		}
		total += len([]rune(text))
		if total > maxPodcastEpisodeChars {
			return nil, middleware.BadRequest(
				fmt.Sprintf("episode must be at most %d characters", maxPodcastEpisodeChars))
		}
		out[index] = podcastTurn{Speaker: strings.TrimSpace(turn.Speaker), Text: text}
	}
	return out, nil
}

// complete 判断已存的译文是否覆盖了每一句。
//
// 用 `TurnIndex` 而不是行数：整集替换保证行数与句数一致，但这一条是
// 「库里只有完整的一集」这道不变量的最后一道检查，写严谨一点。
func complete(rows []store.PodcastTranslation, want int) bool {
	if len(rows) != want {
		return false
	}
	seen := make([]bool, want)
	for _, row := range rows {
		if row.TurnIndex < 0 || row.TurnIndex >= want {
			return false
		}
		seen[row.TurnIndex] = true
	}
	for _, ok := range seen {
		if !ok {
			return false
		}
	}
	return true
}

func toModel(rows []store.PodcastTranslation) []PodcastTranslation {
	out := make([]PodcastTranslation, len(rows))
	for index, row := range rows {
		out[index] = PodcastTranslation{
			TurnIndex:   row.TurnIndex,
			Speaker:     row.Speaker,
			SourceText:  row.SourceText,
			Translation: row.Translation,
		}
	}
	return out
}

func isLowerHex(value string) bool {
	for _, r := range value {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

// SourceHash 是客户端与工具脚本共用的指纹算法。
//
// 把「哪几句、按什么顺序」拼进去：只对文本内容做哈希的话，两句互换
// 位置会得到同一个指纹，而整集译文的顺序就错了。
func SourceHash(lines []string) string {
	digest := sha256.New()
	for _, line := range lines {
		_, _ = digest.Write([]byte(strings.TrimSpace(line)))
		_, _ = digest.Write([]byte{0})
	}
	return hex.EncodeToString(digest.Sum(nil))
}
