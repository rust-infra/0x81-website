// Package scenarios 是预置场景目录（§7.9）。
//
// 场景是**数据不是代码**（§7.8 的判断）：14 个场景的文案、教学点、开场白
// 变体、以及服务端指导语都放在 `data/*.json` 里，用 `go:embed` 打进二进制。
// 这个包里只剩加载、校验与查表。
//
// 一个刻意的结构约束：**服务端专用的 `guidance` 不会出现在
// `model.Scenario` 里**。它只能通过 `Catalog.Guidance()` 单独取出。
// 这样「guidance 绝不下发给客户端」（§4.4）就由类型保证，而不是靠人记得。
package scenarios

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"

	"github.com/0x81/rehearse-backend/internal/model"
)

//go:embed data/*.json
var dataFS embed.FS

// maxTurns 的允许范围，与 moyan-backend 的 `validate_scenario` 一致。
const (
	minTurns = 3
	maxTurns = 20
)

// file 是磁盘上的形状。
//
// 它与 `model.Scenario` 刻意不同：
//   - 展示文案是**双语**的（`title.zh` / `title.en`），查表时按语言取一个
//   - 开场白是**变体池**（3 组），查表时挑一组
//   - 有 `guidance`，而 DTO 没有
type file struct {
	ID          string         `json:"id"`
	Category    model.Category `json:"category"`
	Language    model.Language `json:"language"`
	Difficulty  string         `json:"difficulty"`
	MaxTurns    uint32         `json:"max_turns"`
	Persona     personaFile    `json:"persona"`
	Setting     string         `json:"setting"`
	Title       bilingual      `json:"title"`
	Description bilingual      `json:"description"`
	FocusPoints bilingualList  `json:"focus_points"`
	Openings    []openingFile  `json:"openings"`
	Guidance    string         `json:"guidance"`
}

type personaFile struct {
	Name   string          `json:"name"`
	Role   string          `json:"role"`
	Accent *model.Language `json:"accent"`
	Tone   string          `json:"tone"`
}

type bilingual struct {
	Zh string `json:"zh"`
	En string `json:"en"`
}

type bilingualList struct {
	Zh []string `json:"zh"`
	En []string `json:"en"`
}

type openingFile struct {
	Line      model.Expression   `json:"line"`
	NextLines []model.Expression `json:"next_lines"`
}

// Catalog 是加载好并校验过的场景目录。
type Catalog struct {
	byID  map[string]file
	order []string
}

// Load 读取并校验全部内嵌场景。
//
// 校验失败直接返回错误，不做「跳过坏的继续」。理由：这些文件是**编译进
// 二进制**的，坏文件是构建期问题——`TestCatalogLoads` 会在 CI 里先拦住它。
// 生产环境不可能跑着与 CI 不同的字节。
func Load() (*Catalog, error) {
	entries, err := fs.Glob(dataFS, "data/*.json")
	if err != nil {
		return nil, fmt.Errorf("glob scenario files: %w", err)
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("no scenario files found; the go:embed pattern may be wrong")
	}
	sort.Strings(entries)

	catalog := &Catalog{byID: make(map[string]file, len(entries))}
	for _, entry := range entries {
		raw, err := dataFS.ReadFile(entry)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", entry, err)
		}
		var parsed file
		decoder := json.NewDecoder(bytes.NewReader(raw))
		// 未知字段要报错：JSON 里写错一个键名（比如 `openning`）会被静默忽略，
		// 表现成「场景少了开场白」——比直接失败难查得多。
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&parsed); err != nil {
			return nil, fmt.Errorf("parse %s: %w", entry, err)
		}
		if err := parsed.validate(entry); err != nil {
			return nil, err
		}
		catalog.byID[parsed.ID] = parsed
		catalog.order = append(catalog.order, parsed.ID)
	}
	return catalog, nil
}

func (f file) validate(entry string) error {
	// 文件名必须等于 id：不一致的话，「按 id 找文件」这类调试会骗人。
	want := strings.TrimSuffix(path.Base(entry), ".json")
	if f.ID != want {
		return fmt.Errorf("%s: id %q does not match filename %q", entry, f.ID, want)
	}
	if !f.Category.Valid() {
		return fmt.Errorf("%s: unknown category %q", entry, f.Category)
	}
	if !f.Language.Valid() {
		return fmt.Errorf("%s: unknown language %q", entry, f.Language)
	}
	if f.MaxTurns < minTurns || f.MaxTurns > maxTurns {
		return fmt.Errorf("%s: max_turns %d out of range %d..%d", entry, f.MaxTurns, minTurns, maxTurns)
	}
	if f.Title.Zh == "" || f.Title.En == "" || f.Description.Zh == "" || f.Description.En == "" {
		return fmt.Errorf("%s: title and description must have both zh and en", entry)
	}
	if len(f.FocusPoints.Zh) == 0 || len(f.FocusPoints.En) == 0 {
		return fmt.Errorf("%s: focus_points must have both zh and en", entry)
	}
	if len(f.Openings) == 0 {
		return fmt.Errorf("%s: at least one opening is required", entry)
	}
	for i, opening := range f.Openings {
		if opening.Line.Text == "" {
			return fmt.Errorf("%s: openings[%d].line.text is empty", entry, i)
		}
		if len(opening.NextLines) == 0 {
			return fmt.Errorf("%s: openings[%d] has no next_lines", entry, i)
		}
		for j, next := range opening.NextLines {
			if next.Text == "" {
				return fmt.Errorf("%s: openings[%d].next_lines[%d].text is empty", entry, i, j)
			}
		}
	}
	// guidance 是服务端指导语，空了就等于这个场景没有针对性引导——
	// 那它和随便一个通用 prompt 没区别，属于内容缺陷。
	if strings.TrimSpace(f.Guidance) == "" {
		return fmt.Errorf("%s: guidance must not be empty", entry)
	}
	return nil
}

// Count 返回场景总数。
func (c *Catalog) Count() int { return len(c.order) }

// IDs 返回全部场景 id，按文件名序（稳定）。
func (c *Catalog) IDs() []string {
	out := make([]string, len(c.order))
	copy(out, c.order)
	return out
}

// Get 取出一个场景，展示文案按 `language` 选。
//
// `variant` 用来在开场白变体池里挑一组；调用方传一个随机数即可
// （同一场景多次进入看到不同开场白，是刻意的）。测试传 0 拿确定性结果。
func (c *Catalog) Get(id string, language model.Language, variant int) (model.Scenario, bool) {
	stored, ok := c.byID[id]
	if !ok {
		return model.Scenario{}, false
	}

	opening := stored.Openings[0]
	if variant >= 0 && len(stored.Openings) > 0 {
		opening = stored.Openings[variant%len(stored.Openings)]
	}

	useChinese := language.IsChinese()
	return model.Scenario{
		ID:          stored.ID,
		Source:      model.SourcePreset,
		Category:    stored.Category,
		Language:    stored.Language,
		Title:       pick(useChinese, stored.Title),
		Description: pick(useChinese, stored.Description),
		Persona: model.Persona{
			Name:   stored.Persona.Name,
			Role:   stored.Persona.Role,
			Accent: stored.Persona.Accent,
			Tone:   stored.Persona.Tone,
		},
		Setting:     stored.Setting,
		OpeningLine: opening.Line.Text,
		// 中文场景不给中文对照（§4.3 的规则），英文场景给。
		OpeningLineTranslation: translationFor(opening.Line, useChinese),
		OpeningNextLines:       nextLinesFor(opening.NextLines, useChinese),
		FocusPoints:            pickList(useChinese, stored.FocusPoints),
		Difficulty:             stored.Difficulty,
		MaxTurns:               stored.MaxTurns,
	}, true
}

// List 返回全部场景，按 §5.1 的族顺序再按 id 排，展示文案按 `language` 选。
func (c *Catalog) List(language model.Language) []model.Scenario {
	out := make([]model.Scenario, 0, len(c.order))
	for _, family := range Families {
		for _, id := range family.ExpectedIDs {
			if scenario, ok := c.Get(id, language, 0); ok {
				out = append(out, scenario)
			}
		}
	}
	return out
}

// Guidance 取出服务端指导语（§4.4）。
//
// 单独一个方法是有意的：`model.Scenario` 里没有这个字段，所以它
// 结构上不可能随 DTO 漏给客户端。这是「guidance 绝不下发」的
// 实现方式，而不是一条注释。
func (c *Catalog) Guidance(id string) (string, bool) {
	stored, ok := c.byID[id]
	if !ok {
		return "", false
	}
	return stored.Guidance, true
}

func pick(chinese bool, value bilingual) string {
	if chinese {
		return value.Zh
	}
	return value.En
}

func pickList(chinese bool, value bilingualList) []string {
	if chinese {
		return value.Zh
	}
	return value.En
}

// translationFor 在中文演练时**不给**对照——学习者不需要中文→中文（§4.3）。
func translationFor(expression model.Expression, chinese bool) string {
	if chinese {
		return ""
	}
	return expression.Translation
}

func nextLinesFor(lines []model.Expression, chinese bool) []model.Expression {
	out := make([]model.Expression, 0, len(lines))
	for _, line := range lines {
		out = append(out, model.Expression{
			Text:        line.Text,
			Translation: translationFor(line, chinese),
		})
	}
	return out
}
