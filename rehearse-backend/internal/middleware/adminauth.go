package middleware

import (
	"net/http"
)

// 管理端鉴权：`X-Admin-Token`，与用户侧的 JWT 是**两套**互不相干的凭证。
//
// 移植自 `moyan-backend/src/middleware/admin_auth.rs`（67 行）。
//
// ⚠️ 这两套鉴权绝不能混：管理端接口挂到 JWT 中间件上，等于「任何登录用户
// 都能改全局配置」；反过来把用户接口挂到 admin token 上，则 App 根本进不来。
// 路由装配时两者是两棵独立的子树（见 httpapi/router.go）。

// 401 / 503 的两条消息与 Rust 逐字一致（`admin_auth.rs:8-14`）。
const (
	MsgAdminTokenNotConfigured = "ADMIN_TOKEN is not configured"
	MsgInvalidAdminToken       = "Invalid admin token"
)

// AdminTokenHeader 是管理端凭证的请求头，全小写（Go 的 Header.Get 不区分大小写）。
const AdminTokenHeader = "X-Admin-Token"

// CheckAdminToken 校验管理端凭证。
//
// 两条分支的语义都是刻意的：
//
//   - **没配置 ADMIN_TOKEN** → 503 而不是放行。放行等于把管理端完全敞开；
//     而 503 会让「服务器上漏设这个变量」立刻表现为「管理端用不了」，
//     而不是「管理端谁都能用」。
//   - **配置了但不匹配（含没带）** → 401。`provided == nil` 与「带错了」
//     归成同一条消息：区分它们会给攻击者一个「这个部署配了 token」的信号。
func CheckAdminToken(configured string, provided *string) *APIError {
	if configured == "" {
		return ServiceUnavailable(MsgAdminTokenNotConfigured)
	}
	if provided != nil && *provided == configured {
		return nil
	}
	return Unauthorized(MsgInvalidAdminToken)
}

// RequireAdminToken 返回管理端验票中间件。
func RequireAdminToken(configured string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var provided *string
			if raw := r.Header.Get(AdminTokenHeader); raw != "" {
				provided = &raw
			}
			if err := CheckAdminToken(configured, provided); err != nil {
				WriteError(w, err)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
