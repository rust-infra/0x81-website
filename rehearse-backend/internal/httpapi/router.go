// Package httpapi 是 HTTP 层：路由注册与处理器。
//
// 阶段 2 只有两个端点（§11）：`GET /health` 与一个返回当前用户 id 的调试端点，
// 目的是把「跨语言验签」「401 形状」「自己的 PG 能读写」这三件事先验通。
// 业务端点（`/turn`、`/summary`、`/scenario/draft`、`/material/*`、
// `/api/admin/settings/rehearse`）随阶段 3 补上，路由表见 §7.5。
package httpapi

import (
	"errors"
	"net/http"

	"github.com/0x81/rehearse-backend/internal/config"
	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/0x81/rehearse-backend/internal/scenarios"
	"github.com/0x81/rehearse-backend/internal/store"
)

// errMissingClaims 表示处理器被挂在了 RequireAuth 之外。这是装配错误，
// 不是用户错误——所以回 500 而不是 401，免得掩盖掉真正的配置问题。
var errMissingClaims = errors.New("claims missing from request context: route is not wrapped in RequireAuth")

// NewRouter 组装全部路由。
//
// 认证的挂法：用户接口整棵 `/api/rehearse/` 子树**一次性**包上验签中间件，
// 而不是每个路由各挂一次——漏挂一个就是一个未鉴权端点，而那种错误
// 在 code review 里很难看出来。
func NewRouter(cfg *config.Config, st store.Store, catalog *scenarios.Catalog) http.Handler {
	mux := http.NewServeMux()

	// 健康检查不走鉴权：编排层不会带 token。
	mux.HandleFunc("GET /health", health(st))

	authed := middleware.RequireAuth(cfg.JWTSecret)

	api := http.NewServeMux()
	api.HandleFunc("GET /api/rehearse/whoami", whoami)
	api.HandleFunc("GET /api/rehearse/scenarios", listScenarios(catalog))
	mux.Handle("/api/rehearse/", authed(api))

	// ⚠️ 阶段 3 待补：
	//   - `/api/rehearse/{quota,scenario/draft,turn,summary,material/*}`（§7.5）
	//   - `/api/admin/settings/rehearse`，走 `X-Admin-Token` 而不是用户 JWT（§6.4、§7.7）
	// 两处的鉴权方式不同，别把管理端接口误挂到用户验签中间件上。

	return mux
}

// whoami 是阶段 2 的冒烟端点：把验签结果回显出来，用于确认
// ① `moyan-backend` 签的 token Go 侧能验、② `status` 判定生效、
// ③ 请求上下文里的 user id 正确（§11 阶段 2）。
//
// 它只回显 token 里已有的信息，不读库、不放大权限。
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
