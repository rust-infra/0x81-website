package httpapi

import (
	"github.com/gin-gonic/gin"

	"github.com/0x81/rehearse-backend/internal/coach"
	"github.com/0x81/rehearse-backend/internal/middleware"
)

// 本文件是 `GET|PUT /api/admin/settings/rehearse`（§7.5、§6.4）。
//
// 与用户侧接口有两点结构性差异，都不要「顺手统一」：
//
//  1. **鉴权是 `X-Admin-Token`，不是 JWT**（§7.6 的 admin 行）。
//     挂错中间件等于「任何登录用户都能改全局配置」。
//  2. **一个接口同时管配额与 LLM 配置**（§7.3.2：管理端只有一个 LLM 表单，
//     保存时双写两个后端，Rehearse 这一侧就是本接口）。
//
// 移植自 `moyan-backend/src/controllers/admin.rs:172-200` 的两个
// handler（`get_coach_settings` / `update_coach_settings`）与
// `admin_collect.rs` 的 LLM 部分。

// adminSettingsResponse 是 GET 的响应：配额与 LLM 配置**扁平**合在一层。
//
// 为什么不嵌套成 `{"quota":{...},"llm":{...}}`：管理端的 LLM 表单是
// 与 `/api/admin/settings/llm` **共用同一个**的（§7.3.2 的决定），
// 它 PUT 的 body 是 LLM 那几个扁平字段。响应扁平，同一个表单才能既渲染
// 墨言那边的结果、又渲染这边的结果，不用为 Rehearse 单独写一套解析。
type adminSettingsResponse struct {
	DailyTurnLimit uint32 `json:"daily_turn_limit"`
	Enabled        bool   `json:"enabled"`

	BaseURL      string  `json:"base_url"`
	Model        string  `json:"model"`
	Temperature  float32 `json:"temperature"`
	APIKeySet    bool    `json:"api_key_set"`
	APIKeyMasked *string `json:"api_key_masked"`
}

// adminSettingsUpdate 是 PUT 的请求体：**两边都是局部更新**（全部字段可选）。
//
// ⚠️ 与上游的一处**有意差异**：Rust 的 `PUT /api/admin/settings/coach`
// 是**整体替换**（`coach_settings.update(req)` 直接把 body 存下来，
// 缺字段取 serde 默认值）。这里必须改成局部更新，理由是 §7.3.2 那个决定：
// LLM 表单会把自己的 body（不含 `daily_turn_limit`）也 PUT 到本接口，
// 整体替换会**顺手把配额重置成默认的 100/启用**——管理员改一次模型，
// 配额设置就被静默抹掉一次。那种失败没有任何报错，只有对账时才发现。
type adminSettingsUpdate struct {
	DailyTurnLimit *uint32 `json:"daily_turn_limit"`
	Enabled        *bool   `json:"enabled"`

	BaseURL     *string  `json:"base_url"`
	APIKey      *string  `json:"api_key"`
	Model       *string  `json:"model"`
	Temperature *float32 `json:"temperature"`
	ClearAPIKey bool     `json:"clear_api_key"`
}

func adminGetSettingsHandler(
	quota *coach.QuotaService, llmSettings *coach.LLMSettingsService,
) gin.HandlerFunc {
	return func(c *gin.Context) {
		settings, err := quota.Settings(c.Request.Context())
		if err != nil {
			middleware.Abort(c, middleware.Repository(err))
			return
		}
		public, err := llmSettings.Public(c.Request.Context())
		if err != nil {
			middleware.Abort(c, middleware.Repository(err))
			return
		}
		middleware.OK(c, adminSettingsResponse{
			DailyTurnLimit: settings.DailyTurnLimit,
			Enabled:        settings.Enabled,
			BaseURL:        public.BaseURL,
			Model:          public.Model,
			Temperature:    public.Temperature,
			APIKeySet:      public.APIKeySet,
			APIKeyMasked:   public.APIKeyMasked,
		})
	}
}

func adminUpdateSettingsHandler(
	quota *coach.QuotaService, llmSettings *coach.LLMSettingsService,
) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req adminSettingsUpdate
		if err := bindJSON(c, &req); err != nil {
			middleware.Abort(c, err)
			return
		}

		// 顺序：先配额、后 LLM。两次写是**两个键**，不是一个事务——
		// 中间失败会留下「配额改了、LLM 没改」。这在管理端是可见的
		// （重新 GET 就能看出来），而且两个键本来就各自独立，
		// 比强行塞进一个事务简单得多。
		if req.DailyTurnLimit != nil || req.Enabled != nil {
			current, err := quota.Settings(c.Request.Context())
			if err != nil {
				middleware.Abort(c, middleware.Repository(err))
				return
			}
			if req.DailyTurnLimit != nil {
				current.DailyTurnLimit = *req.DailyTurnLimit
			}
			if req.Enabled != nil {
				current.Enabled = *req.Enabled
			}
			if _, err := quota.UpdateSettings(c.Request.Context(), current); err != nil {
				middleware.Abort(c, middleware.Repository(err))
				return
			}
		}

		if _, err := llmSettings.Update(c.Request.Context(), coach.LLMUpdateRequest{
			BaseURL:     req.BaseURL,
			APIKey:      req.APIKey,
			Model:       req.Model,
			Temperature: req.Temperature,
			ClearAPIKey: req.ClearAPIKey,
		}); err != nil {
			middleware.Abort(c, err)
			return
		}

		// 回写后的完整视图：客户端不用再发一次 GET 就知道实际生效的值
		// （尤其是被 clamp 过的 daily_turn_limit 与被掩码的 key）。
		adminGetSettingsHandler(quota, llmSettings)(c)
	}
}
