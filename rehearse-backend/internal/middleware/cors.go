package middleware

import (
	"net/http"
	"strings"

	"github.com/rs/cors"
)

// CORS 是 CORS 中间件，配置对齐 moyan-backend 的 `CorsLayer`
// （`main.rs:42-61`）：显式 origin 列表（`allow_credentials(true)` 时不能用 `*`）、
// 方法 GET/POST/PUT/PATCH/DELETE/OPTIONS/HEAD、请求头 Authorization /
// Content-Type / Accept / X-Requested-With / X-Client-Id / X-Admin-Token。
//
// ⚠️ Rehearse 实际上**几乎用不到** CORS，留着是为本地浏览器调试与将来的
// Web 端留口子。正常链路里 App 的 fetch 不带 `Origin`（RN 不是浏览器），
// 管理端走 §6.4 的 Caddy 路径分流——浏览器看到的是**同源**请求，不触发预检。
//
// ⚠️⚠️ 白名单为空时**直接返回原 handler，不套 rs/cors**。这不是优化，是安全：
// rs/cors 在 `AllowedOrigins` 为空且没给 `AllowOriginFunc` 时会把
// `allowedOriginsAll` 置为 true（`cors.go:163-167`，注释写着 "Default is all
// origins"）——传一个空列表进去得到的不是「不发 CORS 头」，而是
// **对任何来源都说 yes**。手写那版是「空列表 = 不发头」，语义正好相反，
// 所以这里必须在套之前就分叉。
func CORS(origins []string) func(http.Handler) http.Handler {
	cleaned := make([]string, 0, len(origins))
	for _, origin := range origins {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			cleaned = append(cleaned, trimmed)
		}
	}
	if len(cleaned) == 0 {
		return func(next http.Handler) http.Handler { return next }
	}

	handler := cors.New(cors.Options{
		AllowedOrigins:   cleaned,
		AllowedMethods:   allowedMethods,
		AllowedHeaders:   allowedHeaders,
		AllowCredentials: true,
		MaxAge:           600,
	})
	// 预检由 rs/cors 自己收尾（默认 204，与手写版一致），不再往下走——
	// 否则会撞上「路由不存在」，把预检失败伪装成接口不存在。
	return handler.Handler
}

var (
	allowedMethods = []string{
		http.MethodGet, http.MethodPost, http.MethodPut,
		http.MethodPatch, http.MethodDelete, http.MethodOptions, http.MethodHead,
	}
	allowedHeaders = []string{
		"Authorization", "Content-Type", "Accept",
		"X-Requested-With", "X-Client-Id", AdminTokenHeader,
	}
)
