package scenarios

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/0x81/rehearse-backend/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func mustLoad(t *testing.T) *Catalog {
	t.Helper()
	catalog, err := Load()
	require.NoError(t, err, "Load() 失败")
	return catalog
}

func TestCatalogLoads(t *testing.T) {
	// 这条是所有校验的入口：Load 会对每个文件做 id/文件名一致、枚举合法、
	// max_turns 范围、双语文案非空、开场白非空、guidance 非空等检查。
	_, err := Load()
	require.NoError(t, err, "内嵌场景数据没通过校验")
}

// §5.1 的分族表现在是**可执行的**：加了场景却忘了改文档，这条就红。
func TestCatalogMatchesSection51(t *testing.T) {
	catalog := mustLoad(t)

	assert.Equal(t, ExpectedTotal, catalog.Count(), "场景总数")

	seen := map[string]string{}
	for _, family := range Families {
		for _, id := range family.ExpectedIDs {
			prev, dup := seen[id]
			assert.Falsef(t, dup, "%s 同时出现在 %s 和 %s", id, prev, family.Category)
			seen[id] = string(family.Category)

			scenario, ok := catalog.Get(id, model.LanguageZhCN, 0)
			if !assert.Truef(t, ok, "§5.1 列了 %s，但目录里没有", id) {
				continue
			}
			assert.Equalf(t, family.Category, scenario.Category, "%s 的 category", id)
		}
	}

	// 反向：目录里有、但 §5.1 没列的场景同样是漂移。
	for _, id := range catalog.IDs() {
		_, listed := seen[id]
		assert.Truef(t, listed, "目录里有 %s，但 §5.1 没列出来", id)
	}
}

// §5.2 的映射表：现有 11 个必须原样在（id 不能变），否则就是无意的改名。
func TestPortedScenarioIDsAreStable(t *testing.T) {
	ported := []string{
		"standup_update", "code_review", "design_discussion",
		"incident_sync", "scope_deadline", "ask_for_help",
		"one_on_one", "remote_small_talk",
		"interview_screening", "interview_behavioral", "interview_technical",
	}
	catalog := mustLoad(t)
	for _, id := range ported {
		_, ok := catalog.Get(id, model.LanguageEnUS, 0)
		assert.Truef(t, ok, "从 moyan-backend 移植过来的 %s 不见了", id)
	}
	// §5.2 定的「真新增 3 个」
	for _, id := range []string{"salary_negotiation", "promotion_defense", "bad_news"} {
		_, ok := catalog.Get(id, model.LanguageEnUS, 0)
		assert.Truef(t, ok, "§5.2 声明新增的 %s 不存在", id)
	}
}

// ⚠️ 这条是「guidance 绝不下发」的**结构验证**（§4.4）。
//
// 不是断言「Scenario 结构体里没有 guidance 字段」（那只是编译期事实），
// 而是把它序列化后**在 JSON 里搜 guidance 的正文**——这样即使将来有人
// 给 DTO 加了个带 guidance 的嵌入字段，或者误把它塞进某个 map，也会被抓到。
func TestGuidanceNeverLeaksIntoDTO(t *testing.T) {
	catalog := mustLoad(t)

	for _, id := range catalog.IDs() {
		guidance, ok := catalog.Guidance(id)
		require.Truef(t, ok, "%s: Guidance() 取不到", id)
		require.NotEmptyf(t, strings.TrimSpace(guidance), "%s: guidance 是空的", id)

		scenario, _ := catalog.Get(id, model.LanguageZhCN, 0)
		encoded, err := json.Marshal(scenario)
		require.NoErrorf(t, err, "%s: marshal 失败", id)
		payload := string(encoded)

		// 取 guidance 的一个特征片段（前 12 个字符）去搜，避免整串比对
		// 因空白差异误判。
		needle := firstRunes(guidance, 12)
		assert.NotContainsf(t, payload, needle,
			"%s: DTO 里出现了 guidance 的正文（%q）——服务端指导语泄漏给了客户端", id, needle)
		assert.NotContainsf(t, payload, "guidance", "%s: DTO 里出现了 guidance 这个键名", id)
	}
}

func TestLanguagePicking(t *testing.T) {
	catalog := mustLoad(t)

	zh, _ := catalog.Get("standup_update", model.LanguageZhCN, 0)
	en, _ := catalog.Get("standup_update", model.LanguageEnUS, 0)

	assert.NotEqual(t, zh.Title, en.Title, "中英标题相同，说明按语言取文案没生效")
	require.NotEmpty(t, zh.Title, "标题为空")
	require.NotEmpty(t, en.Title, "标题为空")
	assert.NotEqual(t, zh.FocusPoints[0], en.FocusPoints[0], "focus_points 没有按语言切换")
	// 中文演练不给中文对照（§4.3）。
	assert.Empty(t, zh.OpeningLineTranslation, "中文场景不该有对照")
	assert.NotEmpty(t, en.OpeningLineTranslation, "英文场景应当带中文对照")
}

// 中文场景的对照一律为空——这是 §4.3 的规则，不是内容疏漏。
func TestChineseScenariosHaveNoTranslation(t *testing.T) {
	catalog := mustLoad(t)

	for _, id := range catalog.IDs() {
		scenario, _ := catalog.Get(id, model.LanguageZhCN, 0)
		// 场景的默认语言是中文时，用户大概率用中文练，对照应当为空。
		if scenario.Language != model.LanguageZhCN {
			continue
		}
		assert.Emptyf(t, scenario.OpeningLineTranslation,
			"%s: 中文场景的 opening_line_translation 应为空", id)
		for i, line := range scenario.OpeningNextLines {
			assert.Emptyf(t, line.Translation,
				"%s: 中文场景的 next_lines[%d].translation 应为空", id, i)
		}
	}
}

func TestVariantSelectsDifferentOpenings(t *testing.T) {
	catalog := mustLoad(t)

	// 至少有一个场景带多组开场白，否则「变体池」这个设计没意义。
	multi := 0
	for _, id := range catalog.IDs() {
		first, _ := catalog.Get(id, model.LanguageEnUS, 0)
		second, _ := catalog.Get(id, model.LanguageEnUS, 1)
		if first.OpeningLine != second.OpeningLine {
			multi++
		}
	}
	assert.NotZero(t, multi, "没有任何场景有两组以上开场白")

	// variant 越界要回绕，不能 panic。
	scenario, ok := catalog.Get("standup_update", model.LanguageEnUS, 999)
	require.True(t, ok, "越界 variant 应当回绕，而不是失败")
	assert.NotEmpty(t, scenario.OpeningLine, "越界 variant 取到空开场白")
}

func TestGetUnknownScenario(t *testing.T) {
	catalog := mustLoad(t)
	_, ok := catalog.Get("no_such_scenario", model.LanguageEnUS, 0)
	assert.False(t, ok, "不存在的 id 不该返回 ok")
	_, ok = catalog.Guidance("no_such_scenario")
	assert.False(t, ok, "不存在的 id 不该有 guidance")
}

// List 的顺序由 §5.1 的族顺序决定，UI 的分组依赖它。
func TestListFollowsFamilyOrder(t *testing.T) {
	catalog := mustLoad(t)
	list := catalog.List(model.LanguageZhCN)

	require.Len(t, list, ExpectedTotal, "List 返回数量")
	position := map[model.Category]int{}
	for i, category := range model.AllCategories {
		position[category] = i
	}
	for i := 1; i < len(list); i++ {
		require.LessOrEqualf(t, position[list[i-1].Category], position[list[i].Category],
			"族顺序不对：第 %d 个是 %s，第 %d 个是 %s",
			i-1, list[i-1].Category, i, list[i].Category)
	}
	// 所有下发的场景都必须是 preset。
	for _, scenario := range list {
		assert.Equalf(t, model.SourcePreset, scenario.Source, "%s 的 source", scenario.ID)
	}
}

// 每个场景的 persona 与 max_turns 必须落进 moyan-backend 的校验范围，
// 否则客户端传回来会被自己的校验拒掉。
func TestScenariosPassClientSideValidation(t *testing.T) {
	catalog := mustLoad(t)

	for _, id := range catalog.IDs() {
		scenario, _ := catalog.Get(id, model.LanguageEnUS, 0)
		assert.Truef(t, scenario.Category.Valid(), "%s: category %q 非法", id, scenario.Category)
		assert.Truef(t, scenario.Language.Valid(), "%s: language %q 非法", id, scenario.Language)
		if scenario.Persona.Accent != nil {
			assert.Truef(t, scenario.Persona.Accent.Valid(), "%s: accent %q 非法", id, *scenario.Persona.Accent)
		}
		assert.Truef(t, scenario.MaxTurns >= minTurns && scenario.MaxTurns <= maxTurns,
			"%s: max_turns %d 超出 %d..%d", id, scenario.MaxTurns, minTurns, maxTurns)
		assert.Truef(t, len(scenario.Persona.Name) <= 30 && len(scenario.Persona.Role) <= 60,
			"%s: persona 字段超长", id)
		assert.Truef(t, len(scenario.Title) <= 60 && len(scenario.Description) <= 200,
			"%s: title/description 超长", id)
	}
}

func firstRunes(value string, n int) string {
	runes := []rune(value)
	if len(runes) <= n {
		return value
	}
	return string(runes[:n])
}
