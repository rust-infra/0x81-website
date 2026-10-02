// Package model 是跨语言的线上契约类型（§7.6）。
//
// 这一层的字段名**直接就是 JSON 的键名**，改动等于改契约，客户端要跟着改。
// 几处与 moyan-backend 的差异都是 §7.6 定的：`reply_zh` → `reply_translation`、
// `expressions[].en/zh` → `.text/.translation`、`persona.locale` → `language` +
// `persona.accent`、`coach_mode` → `mode`。
package model

// Category 是场景族（§5.1）。旧值是按「工作类型」分的
// `daily` / `engineering` / `high_stakes`，新值按「演练目的」分——
// 对英语陪练够用的粗分类，对职场演练太窄。
type Category string

const (
	CategoryInterview Category = "interview"
	CategoryPitch     Category = "pitch"
	CategoryHardTalk  Category = "hard_talk"
	CategoryDaily     Category = "daily"
)

// AllCategories 是 §5.1 那张表的顺序，UI 的族分组按它排。
var AllCategories = []Category{
	CategoryInterview,
	CategoryPitch,
	CategoryHardTalk,
	CategoryDaily,
}

// Valid 用于校验客户端传来的 category。
//
// 这里刻意不用 `switch` 而是查表：`exhaustive` 只检查 switch，而
// AllCategories 是唯一的真相源——两处列表不同步的话，switch 版本会
// 悄悄漏掉一个族，查表版本不会。
func (c Category) Valid() bool {
	for _, known := range AllCategories {
		if c == known {
			return true
		}
	}
	return false
}

// Language 是顶层语言开关（§4.2）。它决定 LLM 回复语言、STT 的 lang、
// TTS 音色，以及纠错解释语言。
//
// 注意枚举里没有裸的 "en"：这些值都是 locale，`en-IN` 表示「印度英语」。
// 这是沿用上游的数据形态（旧 `persona.locale` 就是这几个值），
// 好处是迁移无损。
type Language string

const (
	LanguageZhCN Language = "zh-CN"
	LanguageEnUS Language = "en-US"
	LanguageEnGB Language = "en-GB"
	LanguageEnIN Language = "en-IN"
	LanguageEnAU Language = "en-AU"
)

var AllLanguages = []Language{
	LanguageZhCN,
	LanguageEnUS,
	LanguageEnGB,
	LanguageEnIN,
	LanguageEnAU,
}

func (l Language) Valid() bool {
	for _, known := range AllLanguages {
		if l == known {
			return true
		}
	}
	return false
}

// IsChinese 用于判断「需不需要中文对照」——§4.3 定的是
// `language=zh-CN` 时 `reply_translation` 为 null。
func (l Language) IsChinese() bool { return l == LanguageZhCN }

// Source 区分预置场景与用户自建场景。
type Source string

const (
	SourcePreset Source = "preset"
	SourceCustom Source = "custom"
)

// Mode 是演练模式（原 `coach_mode`）。
type Mode string

const (
	ModeFeedback  Mode = "feedback"
	ModeImmersion Mode = "immersion"
)

func (m Mode) Valid() bool { return m == ModeFeedback || m == ModeImmersion }

// Persona 是对话对手的角色设定。
type Persona struct {
	Name string `json:"name"`
	Role string `json:"role"`
	// Accent 只影响 TTS 音色，且仅在 language 为英文时生效（§4.2）。
	// nil 表示不指定、用默认音色。`accent = "zh-CN"` 这种写法已废弃。
	Accent *Language `json:"accent"`
	Tone   string    `json:"tone"`
}

// Expression 是「推荐表达」。
//
// ⚠️ 字段名是 text / translation 而不是 en / zh——中文演练时「本来的语言」
// 是中文，en/zh 会装错东西。§7.6 原本漏了这条，与 `reply_zh` →
// `reply_translation` 是同一套逻辑。
type Expression struct {
	// Text 是目标语言的原句（英文演练时是英文，中文演练时是中文）。
	Text string `json:"text"`
	// Translation 是对照。中文演练时通常为空——学习者不需要中文→中文。
	Translation string `json:"translation"`
}

// Scenario 是**下发给客户端**的场景。
//
// ⚠️ 它刻意**没有** `guidance` 字段。那段服务端指导语只会通过
// `scenarios.Catalog.Guidance()` 单独取出、填进 system prompt，
// 结构上不可能随这个类型漏出去（§4.4）。
type Scenario struct {
	ID       string   `json:"id"`
	Source   Source   `json:"source"`
	Category Category `json:"category"`
	// Language 是场景的默认演练语言，用户开始前可改（§5.4）。
	Language    Language `json:"language"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Persona     Persona  `json:"persona"`
	Setting     string   `json:"setting"`

	OpeningLine string `json:"opening_line"`
	// OpeningLineTranslation 是开场白的对照（原 `opening_line_zh`）。
	// 中文场景里为空——与 `reply_translation` 同一套规则。
	OpeningLineTranslation string `json:"opening_line_translation"`
	// OpeningNextLines 是开场白对应的首轮推荐表达：场景加载后立即展示，
	// 不必等第一轮 AI 响应。
	OpeningNextLines []Expression `json:"opening_next_lines"`

	FocusPoints []string `json:"focus_points"`
	Difficulty  string   `json:"difficulty"`
	MaxTurns    uint32   `json:"max_turns"`
}
