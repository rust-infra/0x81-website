package httpapi

import (
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/0x81/rehearse-backend/internal/model"
	"github.com/0x81/rehearse-backend/internal/scenarios"
)

// listScenarios 是 `GET /api/rehearse/scenarios`。
//
// 响应形状与 moyan-backend 一致（`controllers/coach.rs:15-21`）：
// `{success:true, data:[...]}`——`data` 是**裸数组**，不是包了一层的对象。
//
// 参数从 `locale` 改名为 `language`（§4.2 把「语言」提成了顶层概念，
// 旧名把语言和口音混在一起）。默认值沿用 `zh-CN`。
//
// ⚠️ 这里比 Rust 版**严**：`locale` 非法时 Rust 会静默按英文处理，
// 这里返回 400。理由是静默降级会让客户端的一个拼写错误表现成
// 「场景全是英文」，比一个明确的错误码难查。这是有意的偏离。
func listScenarios(catalog *scenarios.Catalog) gin.HandlerFunc {
	allowed := make([]string, 0, len(model.AllLanguages))
	for _, language := range model.AllLanguages {
		allowed = append(allowed, string(language))
	}
	allowedList := strings.Join(allowed, ", ")

	return func(c *gin.Context) {
		raw := strings.TrimSpace(c.Query("language"))
		if raw == "" {
			raw = string(model.LanguageZhCN)
		}
		language := model.Language(raw)
		if !language.Valid() {
			middleware.Abort(c, middleware.BadRequest("language must be one of "+allowedList))
			return
		}

		// 注意下发的是 `catalog.List()` 的结果——`model.Scenario` 里
		// 没有 guidance 字段，所以服务端指导语结构上不可能出现在这里（§4.4）。
		middleware.OK(c, catalog.List(language))
	}
}
