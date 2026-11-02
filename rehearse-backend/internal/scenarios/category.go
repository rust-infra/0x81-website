package scenarios

import "github.com/0x81/rehearse-backend/internal/model"

// Family 是一个场景族的展示元数据（§5.1）。
type Family struct {
	Category model.Category
	// LabelZh 是后台/文档里用的中文名。
	LabelZh string
	// ExpectedIDs 是 §5.1 那张表逐 id 列出的成员。
	//
	// 把它写成代码（而不是只留在文档里）是有原因的：§5.1 原来只写数字
	// （`pitch` 记 3），结果与 §5.2 的清单对不上——`pitch` 实际只能凑出 2、
	// `hard_talk` 是 4，而描述里的「周会」根本没有对应场景。
	// 现在两处都逐 id 列出，`TestCatalogMatchesSection51` 会直接对账：
	// **加了场景却忘了改 §5.1，测试就红**。
	ExpectedIDs []string
}

// Families 是 §5.1 的族表，顺序即 UI 的分组顺序。
var Families = []Family{
	{
		Category: model.CategoryInterview,
		LabelZh:  "面试。求职、转岗、晋升面",
		ExpectedIDs: []string{
			"interview_screening",
			"interview_behavioral",
			"interview_technical",
			"salary_negotiation",
		},
	},
	{
		Category: model.CategoryPitch,
		LabelZh:  "汇报与答辩。项目评审、晋升答辩",
		ExpectedIDs: []string{
			"design_discussion",
			"promotion_defense",
		},
	},
	{
		Category: model.CategoryHardTalk,
		LabelZh:  "高压对话。故障同步、排期拉扯、负面反馈、承认失误",
		ExpectedIDs: []string{
			"incident_sync",
			"scope_deadline",
			"one_on_one",
			"bad_news",
		},
	},
	{
		Category: model.CategoryDaily,
		LabelZh:  "日常协作。站会、code review、求助、茶水间",
		ExpectedIDs: []string{
			"standup_update",
			"code_review",
			"ask_for_help",
			"remote_small_talk",
		},
	},
}

// ExpectedTotal 是 §5.1 声明的总数（14 = 现有 11 + 真新增 3，§5.2）。
const ExpectedTotal = 14

// FamilyOf 返回某个场景所属的族。
func FamilyOf(id string) (model.Category, bool) {
	for _, family := range Families {
		for _, known := range family.ExpectedIDs {
			if known == id {
				return family.Category, true
			}
		}
	}
	return "", false
}
