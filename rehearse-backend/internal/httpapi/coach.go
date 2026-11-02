package httpapi

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/0x81/rehearse-backend/internal/coach"
	"github.com/0x81/rehearse-backend/internal/middleware"
)

// 本文件是 `/api/rehearse/*` 用户侧接口的公共管道（§7.5 的路由表）。
//
// 移植自 `moyan-backend/src/controllers/coach.rs`（162 行），
// 目标文件是设计稿 §7.9 指定的 `internal/httpapi/coach.go`。
//
// 这一层只做三件事：取 claims、解请求体、把结果包进信封。**所有业务判断
// 都在 `internal/coach` 里**——包括「什么时候扣额度」「什么算非法输入」，
// 那些顺序是护栏的一部分，不该散在 HTTP 层。

// maxJSONBodyBytes 是 JSON 请求体的上限。
//
// 与 axum 的 `DefaultBodyLimit` 默认值一致（2 MiB）。业务上限比它小得多
// （最宽的 `history + user_text` 是 12 000 字符），这一层只是防止有人拿
// 一个 1 GB 的 body 把内存撑爆——**字符数校验拦不住这个**，它要先读完。
const maxJSONBodyBytes = 2 * 1024 * 1024

// authedJSON 是「取 claims → 解请求体 → 调服务 → 写信封」这套样板的唯一实现。
//
// 四个端点的处理器本来各自重复一遍这四步（每个约 18 行），差别只在被调的
// 服务方法——那正是泛型能消掉的部分。现在路由表里一行一个：
//
//	api.POST("/turn", authedJSON(deps.Coach.Turn))
//
// ⚠️ 它**不**替代 `requireClaims` 的错误分支：拿不到 claims 只可能是路由
// 没挂 `RequireAuth`，是装配错误，回 500 而不是 401，免得伪装成「没登录」。
func authedJSON[Req, Res any](
	fn func(ctx context.Context, userID string, req Req) (Res, error),
) gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, ok := requireClaims(c)
		if !ok {
			return
		}
		var req Req
		if err := bindJSON(c, &req); err != nil {
			middleware.Abort(c, err)
			return
		}
		out, err := fn(c.Request.Context(), claims.Sub, req)
		if err != nil {
			middleware.Abort(c, err)
			return
		}
		middleware.OK(c, out)
	}
}

// bindJSON 解请求体，并施加体积上限。
//
// ⚠️ 上限必须在这里设，不能靠业务层的字符数校验：那个校验要先把 body
// 读完才有机会跑，而「读完一个 1 GB 的 body」本身就是要防的事。
//
// 解析失败统一回 **400 + 信封**。上游在同类错误上有两种表现（serde 枚举
// 拒绝 → 422 纯文本；`check_enum` → 400 信封），详见
// `internal/coach/guards.go` 顶部的说明。这里保持信封一致。
func bindJSON(c *gin.Context, target any) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxJSONBodyBytes)
	if err := c.ShouldBindJSON(target); err != nil {
		return middleware.BadRequest("invalid request body: " + err.Error())
	}
	return nil
}

// requireClaims 取验签中间件注入的 claims。
func requireClaims(c *gin.Context) (*middleware.Claims, bool) {
	claims, ok := middleware.ClaimsFrom(c)
	if !ok {
		middleware.Abort(c, middleware.Internal(errMissingClaims))
		return nil, false
	}
	return claims, true
}

// quotaResponse 是 `GET /api/rehearse/quota` 的响应（`controllers/coach.rs:35-45`）。
//
// 比 `coach.QuotaSnapshot` 多一个 `llm_configured`：那个字段要看 LLM 配置，
// 属于两个服务的组合，所以由 HTTP 层拼——配额服务不该知道 LLM 的存在。
type quotaResponse struct {
	Limit     uint32  `json:"limit"`
	Used      uint32  `json:"used"`
	Remaining *uint32 `json:"remaining"`
	ResetsAt  string  `json:"resets_at"`
	Enabled   bool    `json:"enabled"`
	// LLMConfigured 让 App 在服务端还没配好模型时给出准确提示，
	// 而不是等用户点了「开始」再收到一个 503。
	LLMConfigured bool `json:"llm_configured"`
}

// quotaHandler 是唯一一个不能走 `authedJSON` 的端点：它要**读两个服务**
// 再把结果合成一个响应，没有单一的「服务方法」可以传进去。
func quotaHandler(quota *coach.QuotaService, llmSettings *coach.LLMSettingsService) gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, ok := requireClaims(c)
		if !ok {
			return
		}
		snapshot, err := quota.Snapshot(c.Request.Context(), claims.Sub)
		if err != nil {
			middleware.Abort(c, err)
			return
		}
		resolved, err := llmSettings.Resolve(c.Request.Context())
		if err != nil {
			middleware.Abort(c, middleware.Repository(err))
			return
		}
		middleware.OK(c, quotaResponse{
			Limit:         snapshot.Limit,
			Used:          snapshot.Used,
			Remaining:     snapshot.Remaining,
			ResetsAt:      snapshot.ResetsAt,
			Enabled:       snapshot.Enabled,
			LLMConfigured: resolved.Configured(),
		})
	}
}
