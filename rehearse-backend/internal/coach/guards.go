// Package coach 是演练的核心逻辑：校验护栏、prompt 构造、LLM 编排。
//
// 这个包里最重要的文件是 `guards.go` —— §7.8 明说「换语言重写最大的风险
// 不是写不出来，是**悄悄丢掉了原来那些护栏**」，所以护栏集中在这一个文件，
// code review 只盯它。每一条都要能指回 Rust 侧的具体位置。
package coach

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/0x81/rehearse-backend/internal/model"
)

// 输入上限。全部与 moyan-backend 的 `models/coach.rs` 一致——
// 这些数字不是随便定的，改小会误拒合法输入，改大会让 prompt 撑爆上下文。
const (
	MaxHistoryTurns   = 40
	MaxTotalChars     = 12_000
	MaxUserTextChars  = 2_000
	MaxMaterialChars  = 3_000
	MaxReplyChars     = 240
	MaxFocusPoints    = 5
	MaxFocusPointSize = 40
	MaxNextLines      = 2

	// MaxTurnTokens 是单轮 LLM 输出的 token 上限（Rust: MAX_TURN_TOKENS）。
	MaxTurnTokens = 3_000

	MinTurns = 3
	MaxTurns = 20
)

// 字段长度上限，对应 `validate_scenario` 的 check_len 调用。
const (
	maxIDLen          = 80
	maxTitleLen       = 60
	maxDescriptionLen = 200
	maxPersonaNameLen = 30
	maxPersonaRoleLen = 60
	maxOpeningLineLen = 200
)

// Tones / Settings / Difficulties 是场景的枚举字段。
//
// 与 category / language 不同，这三个在 Rust 侧是 String + check_enum，
// 不是真枚举，所以这里也保持字符串 + 白名单——迁移时少一层翻译。
var (
	Tones        = []string{"friendly", "neutral", "direct", "challenging"}
	Settings     = []string{"meeting", "one_on_one", "coffee_chat", "phone_call"}
	Difficulties = []string{"easy", "core", "challenge"}
)

// ValidateScenario 校验并规范化客户端传来的场景。
//
// ⚠️ 场景字段**全部来自客户端**，属于**数据不是指令**（见 model 包的注释）。
// 这里只做结构与限长校验；`guidance` 与 system prompt 由服务端自己拼装，
// 客户端无法传入自由指令字段——这是注入防线的第一层。
//
// `max_turns` 是**夹取**（clamp）而不是报错：客户端传 999 时按 20 处理，
// 传 1 时按 3 处理。其余字段超限一律报错。
func ValidateScenario(input model.Scenario) (model.Scenario, error) {
	if err := checkLen("id", input.ID, maxIDLen); err != nil {
		return model.Scenario{}, err
	}
	if err := checkLen("title", input.Title, maxTitleLen); err != nil {
		return model.Scenario{}, err
	}
	if err := checkLen("description", input.Description, maxDescriptionLen); err != nil {
		return model.Scenario{}, err
	}
	if err := checkLen("persona.name", input.Persona.Name, maxPersonaNameLen); err != nil {
		return model.Scenario{}, err
	}
	if err := checkLen("persona.role", input.Persona.Role, maxPersonaRoleLen); err != nil {
		return model.Scenario{}, err
	}
	if err := checkLen("opening_line", input.OpeningLine, maxOpeningLineLen); err != nil {
		return model.Scenario{}, err
	}

	if !input.Category.Valid() {
		return model.Scenario{}, fmt.Errorf("category must be one of %s", joinCategories())
	}
	if !input.Language.Valid() {
		return model.Scenario{}, fmt.Errorf("language must be one of %s", joinLanguages())
	}
	if input.Persona.Accent != nil && !input.Persona.Accent.Valid() {
		return model.Scenario{}, fmt.Errorf("persona.accent must be one of %s or null", joinLanguages())
	}
	if err := checkEnum("persona.tone", input.Persona.Tone, Tones); err != nil {
		return model.Scenario{}, err
	}
	if err := checkEnum("setting", input.Setting, Settings); err != nil {
		return model.Scenario{}, err
	}
	if err := checkEnum("difficulty", input.Difficulty, Difficulties); err != nil {
		return model.Scenario{}, err
	}
	if len(input.FocusPoints) > MaxFocusPoints {
		return model.Scenario{}, fmt.Errorf("focus_points must have at most %d items", MaxFocusPoints)
	}
	for _, point := range input.FocusPoints {
		if err := checkLen("focus_points[]", point, MaxFocusPointSize); err != nil {
			return model.Scenario{}, err
		}
	}

	out := input
	out.MaxTurns = clamp(input.MaxTurns, MinTurns, MaxTurns)
	return out, nil
}

// ValidateHistory 校验单轮请求的对话历史与用户输入。
//
// 三条限制缺一不可：轮数、单条长度、**总长度**。只看单条的话，
// 40 条各 2000 字能把 prompt 撑到 8 万字。
func ValidateHistory(history []model.Turn, userText string) error {
	if len(history) > MaxHistoryTurns {
		return fmt.Errorf("history must have at most %d turns", MaxHistoryTurns)
	}
	if countRunes(userText) > MaxUserTextChars {
		return fmt.Errorf("user_text must be at most %d characters", MaxUserTextChars)
	}
	if strings.TrimSpace(userText) == "" {
		return fmt.Errorf("user_text is required")
	}
	total := countRunes(userText)
	for _, turn := range history {
		total += countRunes(turn.Content)
	}
	if total > MaxTotalChars {
		return fmt.Errorf("history plus user_text must be at most %d characters", MaxTotalChars)
	}
	return nil
}

// ValidateSummaryHistory 是复盘接口的历史校验：比单轮少了 user_text，
// 但要求历史非空（没有对话就没什么可复盘的）。
func ValidateSummaryHistory(history []model.Turn) error {
	if len(history) == 0 {
		return fmt.Errorf("history is required")
	}
	if len(history) > MaxHistoryTurns {
		return fmt.Errorf("history is too long")
	}
	total := 0
	for _, turn := range history {
		total += countRunes(turn.Content)
	}
	if total > MaxTotalChars {
		return fmt.Errorf("history must be at most %d characters", MaxTotalChars)
	}
	return nil
}

// ValidateMaterial 校验挂载的材料上下文。
//
// ⚠️ 与场景字段一样，`profile` 是**数据不是指令**——它会被包进
// `[BEGIN/END INTERVIEW MATERIAL]` 数据块，并转义掉分隔符（见 prompts.go）。
func ValidateMaterial(material model.MaterialContext) error {
	if !contains(model.MaterialKinds, material.Kind) {
		return fmt.Errorf("material.kind must be one of %s", strings.Join(model.MaterialKinds, ", "))
	}
	if strings.TrimSpace(material.Profile) == "" {
		return fmt.Errorf("material.profile is required")
	}
	if countRunes(material.Profile) > MaxMaterialChars {
		return fmt.Errorf("material.profile must be at most %d characters", MaxMaterialChars)
	}
	return nil
}

// NextTurnIndex 算出本轮是第几轮，并在超出上限时报错。
//
// ⚠️ **这里有一条防作弊护栏**：`completed_turns` 由客户端提供，
// 而它**不能信任**——用户可以传 0 来无限延长会话。所以取
// 「客户端声称的轮数」与「从 history 数出来的轮数」的**较大者**。
//
// 漏掉这个 `.max()` 的话，改一行客户端就能绕过 max_turns，
// 而服务端看不出来——这正是「悄悄丢掉护栏」的典型形态。
func NextTurnIndex(history []model.Turn, completedTurns *uint32, maxTurns uint32) (uint32, error) {
	inferred := uint32(0)
	for _, turn := range history {
		if turn.Role == model.RoleUser {
			inferred++
		}
	}
	previous := inferred
	if completedTurns != nil && *completedTurns > inferred {
		previous = *completedTurns
	}
	if previous >= maxTurns {
		return 0, fmt.Errorf("turn limit of %d has been reached", maxTurns)
	}
	return previous + 1, nil
}

// SanitizeNextLines 过滤「推荐表达」。
//
// 作用是防止推荐表达退化成复读：如果一条 next_line 与 AI 自己的回复、
// 或与纠错里的原文/改正后/更地道的说法/推荐短语**内容相同**，就丢掉。
// 比对用规范化后的形式（只留字母数字、转小写），这样
// "It's on track." 与 "its on track" 会被认成同一条。
//
// 另外：空串丢弃、重复丢弃、最多保留 2 条。
func SanitizeNextLines(lines []model.Expression, feedback *model.Feedback, reply string) []model.Expression {
	blocked := map[string]bool{}
	addBlocked := func(value string) {
		if normalized := normalizePhrase(value); normalized != "" {
			blocked[normalized] = true
		}
	}

	addBlocked(reply)
	if feedback != nil {
		for _, correction := range feedback.Corrections {
			addBlocked(correction.Original)
			addBlocked(correction.Corrected)
		}
		if feedback.BetterPhrasing != nil {
			addBlocked(feedback.BetterPhrasing.Original)
			addBlocked(feedback.BetterPhrasing.Natural)
		}
		for _, expression := range feedback.Expressions {
			addBlocked(expression.Text)
		}
	}

	out := make([]model.Expression, 0, MaxNextLines)
	seen := map[string]bool{}
	for _, line := range lines {
		text := strings.TrimSpace(line.Text)
		translation := strings.TrimSpace(line.Translation)
		normalized := normalizePhrase(text)
		if text == "" || translation == "" || normalized == "" {
			continue
		}
		if blocked[normalized] || seen[normalized] {
			continue
		}
		seen[normalized] = true
		out = append(out, model.Expression{Text: text, Translation: translation})
		if len(out) == MaxNextLines {
			break
		}
	}
	return out
}

// TrimReply 把回复裁到 MaxReplyChars 以内。
//
// 优先在句末标点处切，其次在空格处切——直接按字符数硬切会把单词劈成两半。
func TrimReply(text string) string {
	trimmed := strings.TrimSpace(text)
	if countRunes(trimmed) <= MaxReplyChars {
		return trimmed
	}
	runes := []rune(trimmed)
	candidate := runes[:MaxReplyChars]

	boundary := len(candidate)
	for i := len(candidate) - 1; i >= 0; i-- {
		if candidate[i] == '.' || candidate[i] == '!' || candidate[i] == '?' {
			boundary = i + 1
			break
		}
	}
	if boundary == len(candidate) {
		// 没有句末标点，退而求其次找空格。
		for i := len(candidate) - 1; i >= 0; i-- {
			if unicode.IsSpace(candidate[i]) {
				boundary = i
				break
			}
		}
	}
	return strings.TrimSpace(string(candidate[:boundary]))
}

// StripCodeFences 去掉模型偶尔包上的 ```json ... ``` 围栏。
//
// 明明在 prompt 里要求了「Output JSON only, no markdown fences」，
// 但模型仍会时不时加上——所以解析前必须容错。
func StripCodeFences(raw string) string {
	trimmed := strings.TrimSpace(raw)
	withoutOpen := trimmed
	if rest, ok := strings.CutPrefix(withoutOpen, "```json"); ok {
		withoutOpen = rest
	} else if rest, ok := strings.CutPrefix(withoutOpen, "```"); ok {
		withoutOpen = rest
	}
	withoutClose, _ := strings.CutSuffix(withoutOpen, "```")
	return strings.TrimSpace(withoutClose)
}

// BuildTranscript 拼出 user message。
//
// 与 system prompt 分开：对话内容是**数据**，放在 user 侧；规则与 schema
// 在 system 侧。这样即使对话内容里混进「忽略以上指令」，它在结构上也只是
// 用户说的一句话。
func BuildTranscript(history []model.Turn, userText string) string {
	var builder strings.Builder
	builder.WriteString("Conversation so far:\n")
	for _, turn := range history {
		speaker := "COACH"
		if turn.Role == model.RoleUser {
			speaker = "USER"
		}
		fmt.Fprintf(&builder, "%s: %s\n", speaker, turn.Content)
	}
	fmt.Fprintf(&builder, "USER (latest): %s\n", userText)
	builder.WriteString("Respond as the coach with the JSON object described in your instructions.")
	return builder.String()
}

// DegradedResponse 是 LLM 输出解析失败时的兜底。
//
// ⚠️ **刻意不报错**：模型偶尔会吐出不合法 JSON，把它当成服务故障（500）
// 会让用户看到错误页，而实际上还能继续对话。所以退化成「只有 reply、
// 没有教学反馈」的响应——对话不断，只是这一轮没有纠错。
//
// 注意与 `ErrLLMUnavailable`（503）的区别：那是**请求根本没成功**，
// 这时没有任何内容可展示，只能报错。
func DegradedResponse(raw string, turnIndex uint32, limitReached bool) model.TurnResponse {
	reply := strings.TrimSpace(raw)
	if reply == "" {
		reply = "Sorry, could you say that again?"
	} else {
		reply = TrimReply(reply)
	}
	return model.TurnResponse{
		Reply:        reply,
		Mood:         model.MoodNeutral,
		TurnIndex:    turnIndex,
		LimitReached: limitReached,
		Feedback:     nil,
		NextLines:    []model.Expression{},
	}
}

// normalizePhrase 只保留字母数字并转小写，用于「是不是同一句话」的比对。
func normalizePhrase(value string) string {
	var builder strings.Builder
	for _, r := range strings.ToLower(value) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

// checkLen 按**字符数**（不是字节数）校验，与 Rust 的 chars().count() 对齐。
// 用 len() 的话中文会被算成 3 倍长度，合法输入会被误拒。
func checkLen(field, value string, max int) error {
	if countRunes(value) > max {
		return fmt.Errorf("%s must be at most %d characters", field, max)
	}
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s is required", field)
	}
	return nil
}

func checkEnum(field, value string, allowed []string) error {
	if contains(allowed, value) {
		return nil
	}
	return fmt.Errorf("%s must be one of %s", field, strings.Join(allowed, ", "))
}

func countRunes(value string) int { return len([]rune(value)) }

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func clamp(value, low, high uint32) uint32 {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}

func joinCategories() string {
	out := make([]string, 0, len(model.AllCategories))
	for _, category := range model.AllCategories {
		out = append(out, string(category))
	}
	return strings.Join(out, ", ")
}

func joinLanguages() string {
	out := make([]string, 0, len(model.AllLanguages))
	for _, language := range model.AllLanguages {
		out = append(out, string(language))
	}
	return strings.Join(out, ", ")
}
