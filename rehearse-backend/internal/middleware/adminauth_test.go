package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func str(value string) *string { return &value }

// 这一组逐条对齐 Rust 的 `admin_auth.rs:57-80`（4 个用例）。

// 没配置 ADMIN_TOKEN 时回 503 而不是放行——放行等于把管理端完全敞开。
func TestCheckAdminTokenEmptyConfigured(t *testing.T) {
	err := CheckAdminToken("", str("secret"))
	if err == nil {
		t.Fatal("没配置 token 时应当报错")
	}
	if err.Status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d，期望 503", err.Status)
	}
	if err.Message != MsgAdminTokenNotConfigured {
		t.Fatalf("message = %q", err.Message)
	}
}

func TestCheckAdminTokenWrong(t *testing.T) {
	err := CheckAdminToken("secret", str("wrong"))
	if err == nil {
		t.Fatal("错的 token 应当被拒")
	}
	if err.Status != http.StatusUnauthorized || err.Message != MsgInvalidAdminToken {
		t.Fatalf("err = %+v", err)
	}
}

// 没带 token 与带错了归成同一条消息：区分它们会给攻击者一个
// 「这个部署配了 token」的信号。
func TestCheckAdminTokenMissing(t *testing.T) {
	err := CheckAdminToken("secret", nil)
	if err == nil {
		t.Fatal("没带 token 应当被拒")
	}
	if err.Status != http.StatusUnauthorized || err.Message != MsgInvalidAdminToken {
		t.Fatalf("err = %+v", err)
	}
}

func TestCheckAdminTokenMatches(t *testing.T) {
	if err := CheckAdminToken("secret", str("secret")); err != nil {
		t.Fatalf("正确的 token 不该被拒：%+v", err)
	}
}

// 中间件层：放行时要真的把请求交给下游，拦下时下游**不该被调用**。
func TestRequireAdminTokenMiddleware(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	})
	handler := RequireAdminToken("secret")(next)

	// 通过
	called = false
	req := httptest.NewRequest(http.MethodGet, "/api/admin/settings/rehearse", nil)
	req.Header.Set(AdminTokenHeader, "secret")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent || !called {
		t.Fatalf("带对 token 应当放行：status=%d called=%v", rec.Code, called)
	}

	// 拦下
	called = false
	req = httptest.NewRequest(http.MethodGet, "/api/admin/settings/rehearse", nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d，期望 401", rec.Code)
	}
	if called {
		t.Fatal("被拦下的请求不该到达下游处理器")
	}
}

// ---------------------------------------------------------------- CORS

// 白名单内：回显 origin（不是 `*`）、声明 Vary、带上 Admin-Token 头。
func TestCORSAllowsConfiguredOrigin(t *testing.T) {
	handler := CORS([]string{"https://rehearse.0x81.uk"})(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }))

	req := httptest.NewRequest(http.MethodGet, "/api/rehearse/quota", nil)
	req.Header.Set("Origin", "https://rehearse.0x81.uk")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://rehearse.0x81.uk" {
		t.Fatalf("Allow-Origin = %q", got)
	}
	// 回显 origin 时必须声明 Vary，否则中间缓存会把 A 站的响应喂给 B 站。
	if got := rec.Header().Get("Vary"); got != "Origin" {
		t.Fatalf("Vary = %q，期望 Origin", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("Allow-Credentials = %q", got)
	}
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

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d，CORS 不该拦下请求本身", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("白名单外的 origin 不该拿到 Allow-Origin，得到 %q", got)
	}
}

// 预检直接 204：往下走只会撞上「路由不存在」，把预检失败伪装成接口不存在。
func TestCORSPreflightShortCircuits(t *testing.T) {
	called := false
	handler := CORS(nil)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
	}))

	req := httptest.NewRequest(http.MethodOptions, "/api/rehearse/turn", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d，期望 204", rec.Code)
	}
	if called {
		t.Fatal("预检不该到达下游处理器")
	}
}
