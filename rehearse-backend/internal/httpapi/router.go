// Package httpapi 是 HTTP 层：路由注册与处理器。
//
// 路由表见设计稿 §7.5。这里只做装配与请求/响应转换，业务判断都在
// `internal/coach` 与 `internal/material` 里。
package httpapi

import (
	"errors"
	"net/http"

	"github.com/0x81/rehearse-backend/internal/coach"
	"github.com/0x81/rehearse-backend/internal/config"
	"github.com/0x81/rehearse-backend/internal/material"
	"github.com/0x81/rehearse-backend/internal/middleware"
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

// NewRouter 组装全部路由。
//
// ⚠️ 两棵鉴权子树的边界是这份文件里最要紧的东西：
//
//   - `/api/rehearse/*` 挂**用户 JWT** 验签中间件，整棵子树一次性挂上，
//     而不是每个路由各挂一次——漏挂一个就是一个未鉴权端点，而那种错误
//     在 code review 里很难看出来。
//   - `/api/admin/*` 挂 **`X-Admin-Token`**，与上面互不相干。把管理端接口
//     误挂到用户验签上，等于「任何登录用户都能改全局配额与 LLM 配置」。
//
// `/health` 两者都不挂：编排层的健康检查不会带任何凭证。
func NewRouter(deps Deps) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", health(deps.Store))

	authed := middleware.RequireAuth(deps.Config.JWTSecret)

	api := http.NewServeMux()
	api.HandleFunc("GET /api/rehearse/whoami", whoami)
	api.HandleFunc("GET /api/rehearse/scenarios", listScenarios(deps.Catalog))
	api.HandleFunc("GET /api/rehearse/quota", quotaHandler(deps.Quota, deps.LLMSettings))
	api.HandleFunc("POST /api/rehearse/turn", turnHandler(deps.Coach))
	api.HandleFunc("POST /api/rehearse/summary", summaryHandler(deps.Coach))
	api.HandleFunc("POST /api/rehearse/scenario/draft", draftHandler(deps.Coach))
	api.HandleFunc("POST /api/rehearse/material/text", materialTextHandler(deps.OCR))
	api.HandleFunc("POST /api/rehearse/material/profile", materialProfileHandler(deps.Profile))
	mux.Handle("/api/rehearse/", authed(api))

	admin := http.NewServeMux()
	admin.HandleFunc("GET /api/admin/settings/rehearse", adminGetSettingsHandler(deps.Quota, deps.LLMSettings))
	admin.HandleFunc("PUT /api/admin/settings/rehearse", adminUpdateSettingsHandler(deps.Quota, deps.LLMSettings))
	mux.Handle("/api/admin/", middleware.RequireAdminToken(deps.Config.AdminToken)(admin))

	// CORS 在最外层：预检请求没有凭证，必须在鉴权之前收尾。
	return middleware.CORS(deps.Config.AllowedOrigins)(mux)
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

func whoami(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.ClaimsFrom(r.Context())
	if !ok {
		// 走到这里说明路由没挂 RequireAuth——是装配错误，不是用户错误。
		middleware.WriteError(w, middleware.Internal(errMissingClaims))
		return
	}
	middleware.WriteData(w, http.StatusOK, whoamiResponse{
		Sub:    claims.Sub,
		Email:  claims.Email,
		Name:   claims.Name,
		Status: claims.Status,
	})
}
