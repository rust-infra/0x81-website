package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"
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
	require.NoError(t, err, "sign token")
	return signed
}

// authHarness 装一个只挂了验签中间件的引擎，外加一个回显 claims 的端点。
func authHarness(t *testing.T, secret []byte) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(RequireAuth(secret))
	engine.GET("/whoami", func(c *gin.Context) {
		claims, ok := ClaimsFrom(c)
		require.True(t, ok, "claims 没有进 gin.Context")
		OK(c, map[string]string{"sub": claims.Sub})
	})
	return engine
}

// call 把请求过一遍引擎，返回状态码与原始响应体。
func call(t *testing.T, handler http.Handler, authorization string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/whoami", nil)
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

func TestRequireAuthAcceptsValidToken(t *testing.T) {
	engine := authHarness(t, testSecret)
	status, body := call(t, engine, "Bearer "+signToken(t, testSecret))
	require.Equal(t, http.StatusOK, status, "合法 token 应当放行，body=%s", body)
	require.Contains(t, body, `"sub":"usr_123"`, "响应里应当有 user id")
}

// §13 的硬门槛：401 的形状必须与 moyan-backend **逐字段一致**。
//
// 这条测存在的理由：规格里曾经把它写成 `{"code":"unauthorized"}`（字符串），
// 而真实形状是 `{"code":401}`（数字）。照错的写客户端就得改两套错误处理。
func TestRequireAuthMissingTokenShapeMatchesMoyan(t *testing.T) {
	engine := authHarness(t, testSecret)
	status, body := call(t, engine, "")
	require.Equal(t, http.StatusUnauthorized, status)

	var got struct {
		Success bool `json:"success"`
		Error   struct {
			// 刻意声明成 float64：如果是字符串，json 会解析失败。
			Code    float64 `json:"code"`
			Message string  `json:"message"`
			Reason  string  `json:"reason"`
		} `json:"error"`
	}
	require.NoError(t, json.Unmarshal([]byte(body), &got),
		"响应不是合法 JSON（code 可能被写成了字符串）: %s", body)
	require.False(t, got.Success, "success 应为 false")
	require.Equal(t, float64(http.StatusUnauthorized), got.Error.Code, "error.code 必须是数字 401")
	require.Equal(t, MsgMissingToken, got.Error.Message, "error.message")
	// reason 只在 429 / 422 出现，401 不该有。
	require.Empty(t, got.Error.Reason, "401 不该带 reason")
}

func TestRequireAuthRejectsBadTokens(t *testing.T) {
	engine := authHarness(t, testSecret)
	cases := map[string]string{
		"签名错误":  signToken(t, []byte("a-different-secret")),
		"过期":    signToken(t, testSecret, func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Hour).Unix() }),
		"垃圾字符串": "not-a-jwt",
	}
	for name, token := range cases {
		t.Run(name, func(t *testing.T) {
			status, body := call(t, engine, "Bearer "+token)
			require.Equal(t, http.StatusUnauthorized, status, "body=%s", body)
			require.True(t,
				strings.Contains(body, MsgInvalidToken) || strings.Contains(body, MsgMissingToken),
				"消息不是两条约定之一：%s", body)
		})
	}

	// 只有前缀、没有内容 → 视为没带 token。
	t.Run("空 token", func(t *testing.T) {
		status, body := call(t, engine, "Bearer ")
		require.Equal(t, http.StatusUnauthorized, status)
		require.Contains(t, body, MsgMissingToken)
	})
}

// 不带 Authorization 头与带一个坏 token 必须是**两条不同的消息**——
// 客户端靠它区分「没登录」和「登录过期了」。
func TestRequireAuthDistinguishesMissingFromInvalid(t *testing.T) {
	engine := authHarness(t, testSecret)
	_, missing := call(t, engine, "")
	_, invalid := call(t, engine, "Bearer garbage")

	require.Contains(t, missing, MsgMissingToken, "没带 token 的消息")
	require.Contains(t, invalid, MsgInvalidToken, "坏 token 的消息")
}

// 非 HS256 必须被拒（否则 `alg: none` 之类能绕过验签）。
func TestRequireAuthRejectsNonHS256(t *testing.T) {
	claims := jwt.MapClaims{
		"sub": "usr_123", "status": StatusActive,
		"exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix(),
	}
	// alg=none：签名部分留空
	unsigned, err := jwt.NewWithClaims(jwt.SigningMethodNone, claims).SignedString(jwt.UnsafeAllowNoneSignatureType)
	require.NoError(t, err, "构造 none token")

	status, body := call(t, authHarness(t, testSecret), "Bearer "+unsigned)
	require.Equal(t, http.StatusUnauthorized, status, "alg=none 必须被拒：%s", body)
}

// §7.4.3：只有 active 放行。这是 Rehearse 比 moyan-backend 更严的地方
// （墨言的 jwt_middleware 目前不查 status）。
func TestRequireAuthRejectsInactiveStatus(t *testing.T) {
	engine := authHarness(t, testSecret)
	for _, status := range []string{"disabled", "", "ACTIVE"} {
		t.Run("status="+status, func(t *testing.T) {
			token := signToken(t, testSecret, func(c jwt.MapClaims) { c["status"] = status })
			code, body := call(t, engine, "Bearer "+token)
			require.Equal(t, http.StatusUnauthorized, code, "status=%q 应被拒：%s", status, body)
			require.Contains(t, body, MsgInactiveAccount)
		})
	}
}

// 没有 status 的旧 token（moyan-backend 现在签的就是这种）必须被拒——
// 不能因为「字段缺失」就默认放行。
func TestRequireAuthRejectsTokenWithoutStatus(t *testing.T) {
	token := signToken(t, testSecret, func(c jwt.MapClaims) { delete(c, "status") })
	code, body := call(t, authHarness(t, testSecret), "Bearer "+token)
	require.Equal(t, http.StatusUnauthorized, code, "缺 status 应被拒：%s", body)
}

// 60 秒时钟偏移容忍，与 Rust 侧 jsonwebtoken 的默认 leeway 对齐。
// 不设的话，多机部署下会出现「偶发 401」这种极难复现的故障。
func TestRequireAuthToleratesClockSkewWithinLeeway(t *testing.T) {
	token := signToken(t, testSecret, func(c jwt.MapClaims) {
		c["exp"] = time.Now().Add(-30 * time.Second).Unix() // 刚过期 30 秒
	})
	code, body := call(t, authHarness(t, testSecret), "Bearer "+token)
	require.Equal(t, http.StatusOK, code, "30 秒内的偏移应被容忍：%s", body)
}

func TestExtractBearerCaseInsensitiveScheme(t *testing.T) {
	for _, header := range []string{"Bearer abc", "bearer abc", "BEARER abc"} {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Authorization", header)
		got, ok := extractBearer(req)
		require.True(t, ok, "header %q 应当被识别", header)
		require.Equal(t, "abc", got, "header %q", header)
	}
	// 前缀对但没内容 → 不算带了 token
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer   ")
	_, ok := extractBearer(req)
	require.False(t, ok, "空 bearer 应视为没带 token")
}
