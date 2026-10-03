package middleware

import (
	"net/http"
	"strconv"
	"strings"
)

// CORS：只在 Origin 命中白名单时回响应头。
//
// 移植自 moyan-backend 的 `CorsLayer`（`main.rs:42-61`）——显式 origin 列表
// （`allow_credentials(true)` 时不能用 `*`）、方法 GET/POST/PUT/PATCH/DELETE/
// OPTIONS/HEAD、请求头 Authorization / Content-Type / Accept / X-Requested-With /
// X-Client-Id / X-Admin-Token。
//
// ⚠️ Rehearse 实际上**几乎用不到** CORS，留着是为两件事：
//
//   - 本地用浏览器直接调后端调试（§7.7 的 `ALLOWED_ORIGINS`）
//   - 将来真出现 Web 端时的口子
//
// 正常链路里 App 的 fetch 不带 `Origin`（RN 不是浏览器），管理端走的是
// §6.4 的 Caddy 路径分流——浏览器看到的是**同源**请求，不触发预检。
// 所以白名单为空时这里什么都不发是**正确**行为，不是「忘了配」。
type corsPolicy struct {
	origins map[string]bool
}

// allowedMethods / allowedHeaders 与 Rust 的列表逐条对齐。
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

// CORS 返回 CORS 中间件。`origins` 为空表示不启用（见上面的说明）。
func CORS(origins []string) func(http.Handler) http.Handler {
	policy := corsPolicy{origins: make(map[string]bool, len(origins))}
	for _, origin := range origins {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			policy.origins[trimmed] = true
		}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" && policy.origins[origin] {
				header := w.Header()
				header.Set("Access-Control-Allow-Origin", origin)
				// 回显 origin 而不是 `*`，并显式声明 Vary：白名单是运行时配置，
				// 不声明的话中间缓存会把 A 站的响应喂给 B 站。
				header.Add("Vary", "Origin")
				header.Set("Access-Control-Allow-Credentials", "true")
				header.Set("Access-Control-Allow-Methods", strings.Join(allowedMethods, ", "))
				header.Set("Access-Control-Allow-Headers", strings.Join(allowedHeaders, ", "))
				header.Set("Access-Control-Max-Age", strconv.Itoa(600))
			}

			// 预检直接 204 收尾：它没有「业务处理」可言，往下走只会撞上
			// 路由不存在（405/404），那会把预检失败伪装成接口不存在。
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
