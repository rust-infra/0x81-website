// Package httpapi 是 HTTP 层：路由注册与处理器。
//
// 路由表见设计稿 §7.5。这里只做装配与请求/响应转换，业务判断都在
// `internal/coach` 与 `internal/material` 里。
//
// 框架是 **gin**（2026-10-04 定）。设计稿 §7.9 最初写的是标准库
// `net/http` 的 ServeMux，换掉它的理由是代码量：路由分组、中间件链、
// 请求体绑定、multipart、404 兜底都由框架提供，手写一遍是几百行没有
// 任何业务价值的样板。
package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/0x81/rehearse-backend/internal/coach"
	"github.com/0x81/rehearse-backend/internal/config"
	"github.com/0x81/rehearse-backend/internal/material"
	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/0x81/rehearse-backend/internal/model"
	"github.com/0x81/rehearse-backend/internal/scenarios"
	"github.com/0x81/rehearse-backend/internal/store"
)

// errMissingClaims 表示处理器被挂在了 RequireAuth 之外。这是装配错误，
// 不是用户错误——所以回 500 而不是 401，免得掩盖掉真正的配置问题。
var errMissingClaims = errors.New("claims missing from request context: route is not wrapped in RequireAuth")

// Deps 是装配路由所需的全部依赖。
//
// 用一个结构体而不是一长串参数：装配点只有一个（`cmd/rehearse/main.go`），
// 而参数超过四五个之后，调用处的顺序错误就会变成一个「能编译的 bug」——
// 两个同类型的参数调换位置编译器不会报错。
type Deps struct {
	Config      *config.Config
	Store       store.Store
	Catalog     *scenarios.Catalog
	Coach       *coach.Service
	Quota       *coach.QuotaService
	LLMSettings *coach.LLMSettingsService
	OCR         *material.OCRService
	Profile     *material.ProfileService
}

// NewRouter 组装全部路由，返回 http.Handler（`*gin.Engine` 满足它）。
//
// ⚠️ 两棵鉴权子树的边界是这份文件里最要紧的东西：
//
//   - `/api/rehearse/*` 挂**用户 JWT** 验签中间件，整棵子树一次性挂上
//     （`Group` 的第二个参数），而不是每个路由各挂一次——漏挂一个就是一个
//     未鉴权端点，而那种错误在 code review 里很难看出来。
//   - `/api/admin/*` 挂 **`X-Admin-Token`**，与上面互不相干。把管理端接口
//     误挂到用户验签上，等于「任何登录用户都能改全局配额与 LLM 配置」。
//
// `/health` 两者都不挂：编排层的健康检查不会带任何凭证。
func NewRouter(deps Deps) http.Handler {
	// `gin.New()` 而不是 `gin.Default()`：后者自带一个写 stdout 的
	// access log，格式与本服务的 slog JSON 日志不一致，混在一起没法按行解析。
	// Recovery 保留——一个 handler 里的 panic 不该把整个进程带走。
	engine := gin.New()
	engine.Use(gin.Recovery(), accessLog())

	engine.GET("/health", health(deps.Store))

	api := engine.Group("/api/rehearse", middleware.RequireAuth(deps.Config.JWTSecret))
	api.GET("/whoami", whoami)
	api.GET("/scenarios", listScenarios(deps.Catalog))
	api.GET("/quota", quotaHandler(deps.Quota, deps.LLMSettings))
	api.POST("/turn", authedJSON(deps.Coach.Turn))
	api.POST("/scenario/draft", authedJSON(deps.Coach.DraftScenario))
	api.POST("/material/profile", authedJSON(deps.Profile.Profile))
	// 复盘不需要 user id：它不计额度、不写任何按用户的数据（`controllers/coach.rs:57-63`
	// 同样不取 claims）。它**仍然在验签子树下**——鉴权（这是谁）与
	// 授权用不用得上（拿 sub 做什么）是两件事。
	api.POST("/summary", authedJSON(
		func(ctx context.Context, _ string, req model.SummaryRequest) (model.SummaryResponse, error) {
			return deps.Coach.Summary(ctx, req)
		}))
	// 材料上传是 multipart，走不了 authedJSON（见 material.go）。
	api.POST("/material/text", materialTextHandler(deps.OCR))

	admin := engine.Group("/api/admin", middleware.RequireAdminToken(deps.Config.AdminToken))
	admin.GET("/settings/rehearse", adminGetSettingsHandler(deps.Quota, deps.LLMSettings))
	admin.PUT("/settings/rehearse", adminUpdateSettingsHandler(deps.Quota, deps.LLMSettings))

	// 兜底 404 也走信封。gin 默认回的是纯文本 `404 page not found`，
	// 与其余所有响应不一致——客户端解 JSON 会拿到一个语法错误，
	// 而不是一个「路径写错了」的明确信号。
	engine.NoRoute(func(c *gin.Context) {
		middleware.Abort(c, middleware.NotFound("Not found"))
	})

	// CORS 在最外层（包住 gin 引擎）：预检请求不带凭证，必须在鉴权之前收尾。
	return middleware.CORS(deps.Config.AllowedOrigins)(engine)
}

// accessLog 是 gin 版的访问日志，替代 Rust 侧的 `TraceLayer`。
//
// 只记方法、路径、状态码、耗时。**不记请求体、不记 query 原文**——
// query 里可能有语言/场景 id 之类的东西，而 §13 的隐私约定是材料与
// 对话内容不进日志；一条笼统的规则比逐个端点判断更难写错。
func accessLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		slog.Info("request",
			"method", c.Request.Method,
			"path", c.FullPath(),
			"status", c.Writer.Status(),
			"duration_ms", time.Since(start).Milliseconds(),
		)
	}
}

// whoami 是阶段 2 的冒烟端点：把验签结果回显出来，用于确认
// ① `moyan-backend` 签的 token Go 侧能验、② `status` 判定生效、
// ③ 请求上下文里的 user id 正确（§11 阶段 2）。
//
// 它只回显 token 里已有的信息，不读库、不放大权限。保留它是为了线上排障时
// 能一条 curl 分清「凭证问题」和「业务问题」——它不在 §7.5 的路由表里，
// 是唯一一个表外的端点。
type whoamiResponse struct {
	Sub    string `json:"sub"`
	Email  string `json:"email"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

func whoami(c *gin.Context) {
	claims, ok := middleware.ClaimsFrom(c)
	if !ok {
		// 走到这里说明路由没挂 RequireAuth——是装配错误，不是用户错误。
		middleware.Abort(c, middleware.Internal(errMissingClaims))
		return
	}
	middleware.OK(c, whoamiResponse{
		Sub:    claims.Sub,
		Email:  claims.Email,
		Name:   claims.Name,
		Status: claims.Status,
	})
}
