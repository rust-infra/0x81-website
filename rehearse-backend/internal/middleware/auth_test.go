package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var testSecret = []byte("test-secret-ascii-only")

// signToken 用与 moyan-backend 相同的方式签一个 token：
// HS256 + 整数秒的 exp/iat（§7.4.3）。用 MapClaims 而不是本包的 Claims，
// 是为了精确控制落盘的 JSON 类型——测的就是这份字节。
func signToken(t *testing.T, secret []byte, mutators ...func(jwt.MapClaims)) string {
	t.Helper()
	now := time.Now()
	claims := jwt.MapClaims{
		"sub":    "usr_123",
		"email":  "a@b.c",
		"name":   "测试用户",
		"status": StatusActive,
		"exp":    now.Add(time.Hour).Unix(),
		"iat":    now.Unix(),
	}
	for _, mutate := range mutators {
		mutate(claims)
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}

// call 把请求过一遍中间件，返回状态码与原始响应体。
func call(t *testing.T, handler http.Handler, authorization string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/rehearse/whoami", nil)
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

func okHandler(t *testing.T) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := ClaimsFrom(r.Context())
		if !ok {
			t.Error("claims 没有进请求上下文")
			return
		}
		WriteData(w, http.StatusOK, map[string]string{"sub": claims.Sub})
	})
}

func TestRequireAuth_AcceptsValidToken(t *testing.T) {
	token := signToken(t, testSecret)
	status, body := call(t, RequireAuth(testSecret)(okHandler(t)), "Bearer "+token)
	if status != http.StatusOK {
		t.Fatalf("status = %d, body = %s", status, body)
	}
	if want := `"sub":"usr_123"`; !strings.Contains(body, want) {
		t.Fatalf("响应里没有 user id：%s", body)
	}
}

// §13 的硬门槛：401 的形状必须与 moyan-backend **逐字段一致**。
//
// 这条测存在的理由：规格里曾经把它写成 `{"code":"unauthorized"}`（字符串），
// 而真实形状是 `{"code":401}`（数字）。照错的写客户端就得改两套错误处理。
func TestRequireAuth_MissingTokenShapeMatchesMoyan(t *testing.T) {
	status, body := call(t, RequireAuth(testSecret)(okHandler(t)), "")
	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d", status)
	}

	var got struct {
		Success bool `json:"success"`
		Error   struct {
			// 刻意声明成 float64：如果是字符串，json 会解析失败。
			Code    float64 `json:"code"`
			Message string  `json:"message"`
			Reason  string  `json:"reason"`
		} `json:"error"`
	}
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatalf("响应不是合法 JSON（code 可能被写成了字符串）: %v\nbody=%s", err, body)
	}
	if got.Success {
		t.Error("success 应为 false")
	}
	if got.Error.Code != http.StatusUnauthorized {
		t.Errorf("error.code = %v, want 401（数字）", got.Error.Code)
	}
	if got.Error.Message != MsgMissingToken {
		t.Errorf("error.message = %q, want %q", got.Error.Message, MsgMissingToken)
	}
	// reason 只在 429 / 422 出现，401 不该有。
	if got.Error.Reason != "" {
		t.Errorf("401 不该带 reason，却出现了 %q", got.Error.Reason)
	}
}

func TestRequireAuth_RejectsBadTokens(t *testing.T) {
	cases := map[string]string{
		"签名错误":    signToken(t, []byte("a-different-secret")),
		"过期":      signToken(t, testSecret, func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Hour).Unix() }),
		"垃圾字符串":   "not-a-jwt",
		"空 token": "",
	}
	for name, token := range cases {
		t.Run(name, func(t *testing.T) {
			header := "Bearer " + token
			if token == "" {
				header = "Bearer " // 只有前缀，没有内容
			}
			status, body := call(t, RequireAuth(testSecret)(okHandler(t)), header)
			if status != http.StatusUnauthorized {
				t.Fatalf("status = %d, body = %s", status, body)
			}
			if !strings.Contains(body, MsgInvalidToken) && !strings.Contains(body, MsgMissingToken) {
				t.Fatalf("消息不是两条约定之一：%s", body)
			}
		})
	}
}

// 不带 Authorization 头与带一个坏 token 必须是**两条不同的消息**——
// 客户端靠它区分「没登录」和「登录过期了」。
func TestRequireAuth_DistinguishesMissingFromInvalid(t *testing.T) {
	_, missing := call(t, RequireAuth(testSecret)(okHandler(t)), "")
	_, invalid := call(t, RequireAuth(testSecret)(okHandler(t)), "Bearer garbage")

	if !strings.Contains(missing, MsgMissingToken) {
		t.Errorf("没带 token 时应回 %q，实际 %s", MsgMissingToken, missing)
	}
	if !strings.Contains(invalid, MsgInvalidToken) {
		t.Errorf("坏 token 时应回 %q，实际 %s", MsgInvalidToken, invalid)
	}
}

// 非 HS256 必须被拒（否则 `alg: none` 之类能绕过验签）。
func TestRequireAuth_RejectsNonHS256(t *testing.T) {
	claims := jwt.MapClaims{
		"sub": "usr_123", "status": StatusActive,
		"exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix(),
	}
	// alg=none：签名部分留空
	unsigned, err := jwt.NewWithClaims(jwt.SigningMethodNone, claims).SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("构造 none token 失败: %v", err)
	}
	status, body := call(t, RequireAuth(testSecret)(okHandler(t)), "Bearer "+unsigned)
	if status != http.StatusUnauthorized {
		t.Fatalf("alg=none 必须被拒，却得到 %d: %s", status, body)
	}
}

// §7.4.3：只有 active 放行。这是 Rehearse 比 moyan-backend 更严的地方
// （墨言的 jwt_middleware 目前不查 status）。
func TestRequireAuth_RejectsInactiveStatus(t *testing.T) {
	for _, status := range []string{"disabled", "", "ACTIVE"} {
		t.Run("status="+status, func(t *testing.T) {
			token := signToken(t, testSecret, func(c jwt.MapClaims) { c["status"] = status })
			code, body := call(t, RequireAuth(testSecret)(okHandler(t)), "Bearer "+token)
			if code != http.StatusUnauthorized {
				t.Fatalf("status=%q 应被拒，却得到 %d: %s", status, code, body)
			}
			if !strings.Contains(body, MsgInactiveAccount) {
				t.Fatalf("应回 %q，实际 %s", MsgInactiveAccount, body)
			}
		})
	}
}

// 没有 status 的旧 token（moyan-backend 现在签的就是这种）必须被拒——
// 不能因为「字段缺失」就默认放行。
func TestRequireAuth_RejectsTokenWithoutStatus(t *testing.T) {
	token := signToken(t, testSecret, func(c jwt.MapClaims) { delete(c, "status") })
	code, body := call(t, RequireAuth(testSecret)(okHandler(t)), "Bearer "+token)
	if code != http.StatusUnauthorized {
		t.Fatalf("缺 status 应被拒，却得到 %d: %s", code, body)
	}
}

// 60 秒时钟偏移容忍，与 Rust 侧 jsonwebtoken 的默认 leeway 对齐。
// 不设的话，多机部署下会出现「偶发 401」这种极难复现的故障。
func TestRequireAuth_ToleratesClockSkewWithinLeeway(t *testing.T) {
	token := signToken(t, testSecret, func(c jwt.MapClaims) {
		c["exp"] = time.Now().Add(-30 * time.Second).Unix() // 刚过期 30 秒
	})
	code, body := call(t, RequireAuth(testSecret)(okHandler(t)), "Bearer "+token)
	if code != http.StatusOK {
		t.Fatalf("30 秒内的偏移应被容忍，却得到 %d: %s", code, body)
	}
}

func TestExtractBearer_CaseInsensitiveScheme(t *testing.T) {
	for _, header := range []string{"Bearer abc", "bearer abc", "BEARER abc"} {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Authorization", header)
		if got, ok := extractBearer(req); !ok || got != "abc" {
			t.Errorf("header %q: got (%q, %v)", header, got, ok)
		}
	}
	// 前缀对但没内容 → 不算带了 token
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer   ")
	if _, ok := extractBearer(req); ok {
		t.Error("空 bearer 应视为没带 token")
	}
}
