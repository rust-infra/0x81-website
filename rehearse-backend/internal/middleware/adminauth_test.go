package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func str(value string) *string { return &value }

// 这一组逐条对齐 Rust 的 `admin_auth.rs:57-80`（4 个用例）。

// 没配置 ADMIN_TOKEN 时回 503 而不是放行——放行等于把管理端完全敞开。
func TestCheckAdminTokenEmptyConfigured(t *testing.T) {
	err := CheckAdminToken("", str("secret"))
	require.NotNil(t, err, "没配置 token 时应当报错")
	require.Equal(t, http.StatusServiceUnavailable, err.Status, "状态码")
	require.Equal(t, MsgAdminTokenNotConfigured, err.Message, "消息")
}

func TestCheckAdminTokenWrong(t *testing.T) {
	err := CheckAdminToken("secret", str("wrong"))
	require.NotNil(t, err, "错的 token 应当被拒")
	require.Equal(t, http.StatusUnauthorized, err.Status)
	require.Equal(t, MsgInvalidAdminToken, err.Message)
}

// 没带 token 与带错了归成同一条消息：区分它们会给攻击者一个
// 「这个部署配了 token」的信号。
func TestCheckAdminTokenMissing(t *testing.T) {
	err := CheckAdminToken("secret", nil)
	require.NotNil(t, err, "没带 token 应当被拒")
	require.Equal(t, http.StatusUnauthorized, err.Status)
	require.Equal(t, MsgInvalidAdminToken, err.Message)
}

func TestCheckAdminTokenMatches(t *testing.T) {
	require.Nil(t, CheckAdminToken("secret", str("secret")), "正确的 token 不该被拒")
}

// adminHarness 装一个只挂了管理端验票的引擎。
//
// 返回的 *bool 让用例能断言「被拦下的请求**没有**到达下游」——只看状态码
// 的话，一个「先执行下游再回 401」的实现也能过。
func adminHarness(t *testing.T, configured string) (*gin.Engine, *bool) {
	t.Helper()
	called := false
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(RequireAdminToken(configured))
	engine.GET("/admin", func(c *gin.Context) {
		called = true
		c.Status(http.StatusNoContent)
	})
	return engine, &called
}

func TestRequireAdminTokenMiddleware(t *testing.T) {
	engine, called := adminHarness(t, "secret")

	// 带对 token：放行，且下游被执行
	req := httptest.NewRequest(http.MethodGet, "/admin", nil)
	req.Header.Set(AdminTokenHeader, "secret")
	rec := httptest.NewRecorder()
	engine.ServeHTTP(rec, req)
	require.Equal(t, http.StatusNoContent, rec.Code, "带对 token 应当放行")
	require.True(t, *called, "带对 token 时下游应当被执行")

	// 不带：拦下，且下游**没有**被执行
	*called = false
	rec = httptest.NewRecorder()
	engine.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/admin", nil))
	require.Equal(t, http.StatusUnauthorized, rec.Code)
	require.False(t, *called, "被拦下的请求不该到达下游处理器")
}

// ---------------------------------------------------------------- CORS

// 白名单内：回显 origin（不是 `*`）、声明 Vary、带上凭证开关。
func TestCORSAllowsConfiguredOrigin(t *testing.T) {
	handler := CORS([]string{"https://rehearse.0x81.uk"})(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }))

	req := httptest.NewRequest(http.MethodGet, "/api/rehearse/quota", nil)
	req.Header.Set("Origin", "https://rehearse.0x81.uk")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Equal(t, "https://rehearse.0x81.uk", rec.Header().Get("Access-Control-Allow-Origin"))
	// 回显 origin 时必须声明 Vary，否则中间缓存会把 A 站的响应喂给 B 站。
	require.Equal(t, "Origin", rec.Header().Get("Vary"))
	require.Equal(t, "true", rec.Header().Get("Access-Control-Allow-Credentials"))
}

// 白名单外：**不发任何 CORS 头**（浏览器据此拦截），但仍然放行请求本身——
// CORS 是浏览器的策略，不是服务端的访问控制。服务端的访问控制是鉴权。
func TestCORSRejectsUnlistedOrigin(t *testing.T) {
	handler := CORS([]string{"https://rehearse.0x81.uk"})(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }))

	req := httptest.NewRequest(http.MethodGet, "/api/rehearse/quota", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, "CORS 不该拦下请求本身")
	require.Empty(t, rec.Header().Get("Access-Control-Allow-Origin"),
		"白名单外的 origin 不该拿到 Allow-Origin")
}

// 预检在中间件这一层就收尾，不再往下走。
//
// ⚠️ 只有带 `Access-Control-Request-Method` 的 OPTIONS 才算预检——浏览器
// 一定会带它。不带的话那只是一个「恰好是 OPTIONS 的普通请求」，会正常
// 往下走（然后被路由或鉴权拒掉），这是对的：预检不带凭证，让它进到鉴权
// 后面只会得到 401。
func TestCORSPreflightShortCircuits(t *testing.T) {
	called := false
	handler := CORS([]string{"https://rehearse.0x81.uk"})(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) { called = true }))

	req := httptest.NewRequest(http.MethodOptions, "/api/rehearse/turn", nil)
	req.Header.Set("Origin", "https://rehearse.0x81.uk")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusNoContent, rec.Code)
	require.False(t, called, "预检不该到达下游处理器")
}

// 白名单为空时**不套 rs/cors**：rs/cors 把「空列表」理解成「允许所有来源」
// （cors.go:163-167 的 "Default is all origins"），与我们要的「不发 CORS 头」
// 正好相反。这两条测试钉住那个分叉。
func TestCORSDisabledNeverAllowsAnyOrigin(t *testing.T) {
	handler := CORS(nil)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/rehearse/quota", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Empty(t, rec.Header().Get("Access-Control-Allow-Origin"),
		"空白名单时绝不能回 Allow-Origin")
}

func TestCORSDisabledWithBlankStrings(t *testing.T) {
	// 全是空白的配置也要被当成「没配」，不能把空串当成一个合法 origin。
	handler := CORS([]string{"", "   "})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/rehearse/quota", nil)
	req.Header.Set("Origin", "https://rehearse.0x81.uk")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Empty(t, rec.Header().Get("Access-Control-Allow-Origin"))
}

// 预检请求里列出了不允许的请求头时，整个预检被中止（连 Allow-Origin 都不回）。
// 这条写下来是因为它的症状很迷惑：跨域全挂，而原因只是请求头名单没配齐。
func TestCORSPreflightAbortsOnUnlistedRequestHeader(t *testing.T) {
	handler := CORS([]string{"https://rehearse.0x81.uk"})(http.HandlerFunc(
		func(http.ResponseWriter, *http.Request) {}))

	req := httptest.NewRequest(http.MethodOptions, "/api/rehearse/turn", nil)
	req.Header.Set("Origin", "https://rehearse.0x81.uk")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "x-not-allowed")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusNoContent, rec.Code)
	require.Empty(t, rec.Header().Get("Access-Control-Allow-Origin"),
		"请求了不允许的头时，整个预检应当被中止")
}

// 允许的请求头要按原样回显（Fetch 标准保证它们是小写的）。
func TestCORSPreflightEchoesAllowedRequestHeaders(t *testing.T) {
	handler := CORS([]string{"https://rehearse.0x81.uk"})(http.HandlerFunc(
		func(http.ResponseWriter, *http.Request) {}))

	req := httptest.NewRequest(http.MethodOptions, "/api/rehearse/turn", nil)
	req.Header.Set("Origin", "https://rehearse.0x81.uk")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "authorization,x-admin-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	allowed := strings.ToLower(rec.Header().Get("Access-Control-Allow-Headers"))
	require.Contains(t, allowed, "x-admin-token", "管理端跨域时要用它")
	require.Contains(t, allowed, "authorization")
}
