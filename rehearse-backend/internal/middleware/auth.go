package middleware

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims 是跨语言契约（§7.4.3）。
//
// 与 moyan-backend 的 `middleware::auth::Claims` 逐字段对齐，**外加 `status`**。
// 时间字段刻意用 int64 而不是 jwt.NumericDate：契约要求 `exp` / `iat` 是
// **整数秒**，用 int64 解析能让「上游写了浮点」直接失败，而不是静默截断。
type Claims struct {
	Sub    string `json:"sub"` // user id
	Email  string `json:"email"`
	Name   string `json:"name"`
	Status string `json:"status"` // active / disabled（§7.4.3）
	Exp    int64  `json:"exp"`
	Iat    int64  `json:"iat"`
}

// 实现 jwt.Claims，让 jwt/v5 自动校验 exp。
func (c *Claims) GetExpirationTime() (*jwt.NumericDate, error) {
	return jwt.NewNumericDate(time.Unix(c.Exp, 0)), nil
}

func (c *Claims) GetIssuedAt() (*jwt.NumericDate, error) {
	return jwt.NewNumericDate(time.Unix(c.Iat, 0)), nil
}

func (c *Claims) GetNotBefore() (*jwt.NumericDate, error) { return nil, nil }
func (c *Claims) GetIssuer() (string, error)              { return "", nil }
func (c *Claims) GetAudience() (jwt.ClaimStrings, error)  { return nil, nil }
func (c *Claims) GetSubject() (string, error)             { return c.Sub, nil }

// Leeway 与 Rust 侧保持一致：jsonwebtoken 的 `Validation::new` 默认容忍
// 60 秒时钟偏移。Go 侧不设的话，同一台机器上签的 token 在另一台上可能因
// 几秒偏差被判过期——症状是「偶发 401」，很难复现。
const Leeway = 60 * time.Second

// StatusActive 是唯一放行的 status 值（§7.4.3）。
const StatusActive = "active"

type claimsKey struct{}

// RequireAuth 返回验签中间件。
//
// ⚠️ 这里**故意不实现** moyan-backend 的 legacy token 兜底分支
// （`ALLOW_LEGACY_TOKEN_AUTH`）。那个开关在线上必须关闭，而它的存在本身
// 就是一个「随手编一个 Bearer 就能读到自己名下数据」的洞（见
// `moyan-backend/src/middleware/auth.rs:28-41` 的注释）。Rehearse 侧从第一天起
// 就不带这个分支——§7.4.2 与 §13 把「代码里不存在兜底认证逻辑」列为验收项。
//
// 同样不做的事：OAuth、签发 token、建号、读 `users` 表。Rehearse 只消费
// 认证服务已经确定的身份。
func RequireAuth(secret []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, ok := extractBearer(r)
			if !ok {
				WriteError(w, Unauthorized(MsgMissingToken))
				return
			}

			claims := &Claims{}
			_, err := jwt.ParseWithClaims(raw, claims, func(*jwt.Token) (any, error) {
				return secret, nil
			},
				// 只接受 HS256，与 Rust 侧 `Validation::new(Algorithm::HS256)` 对齐。
				// 不限定算法会让 `alg: none` 之类的攻击面存在。
				jwt.WithValidMethods([]string{"HS256"}),
				// exp 必填——Rust 侧默认 required_spec_claims 含 exp。
				jwt.WithExpirationRequired(),
				jwt.WithLeeway(Leeway),
			)
			if err != nil {
				// 不把底层错误下发：它可能泄漏密钥或 token 内容（§13）。
				WriteError(w, Unauthorized(MsgInvalidToken))
				return
			}

			// status 检查（§7.4.3）。moyan-backend 目前不做这一步，所以这是
			// Rehearse 侧更严的地方；等墨言补上后两边行为一致。
			if claims.Status != StatusActive {
				WriteError(w, Unauthorized(MsgInactiveAccount))
				return
			}

			ctx := context.WithValue(r.Context(), claimsKey{}, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ClaimsFrom 取出中间件注入的 claims。只有走过 RequireAuth 的处理器才会拿到。
func ClaimsFrom(ctx context.Context) (*Claims, bool) {
	claims, ok := ctx.Value(claimsKey{}).(*Claims)
	return claims, ok
}

func extractBearer(r *http.Request) (string, bool) {
	header := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(header) <= len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
		return "", false
	}
	token := strings.TrimSpace(header[len(prefix):])
	return token, token != ""
}
