// Package middleware 提供 HTTP 层的横切能力：错误信封、JWT 验签、管理端验票、CORS。
//
// 本文件是**逐字段复刻** moyan-backend 的响应形状
// （`moyan-backend/src/middleware/error.rs`）。这不是风格问题：
// §7.6 与 §13 把「响应结构与 Rust 版一致」列为验收门槛，形状不一致
// 客户端就得写两套错误处理。
//
// ⚠️ 两个历史上容易写错的点（规格里也错过一次，已修）：
//
//  1. `error.code` 是 **HTTP 状态码（数字）**，不是字符串枚举。
//     401 的形状是 `{"code":401,...}` 而**不是** `{"code":"unauthorized",...}`。
//  2. `reason` 只在 429 / 422 出现；其余分支没有这个键。
//
// 信封的构造是**纯函数**（`Envelope` / `DataEnvelope`），gin 只是最后一步
// 序列化。这样「形状对不对」可以脱离框架单测，也避免把状态码映射写进
// 框架的调用约定里。
package middleware

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
)

// 401 的两条消息与 moyan-backend 完全一致（`middleware/auth.rs:50/60`）。
// 拆成两条是为了让客户端能区分「没带凭证」和「凭证坏了」。
const (
	MsgMissingToken = "Missing authorization token"
	MsgInvalidToken = "Invalid or expired token"
)

// MsgInactiveAccount 是 Go 侧新增的：moyan-backend 目前不检查 status（§7.4.3），
// 所以没有对应的原文。等墨言补上这个检查后，两边应统一到同一条消息。
const MsgInactiveAccount = "Account is not active"

// APIError 是一次失败的响应。
type APIError struct {
	Status  int
	Message string
	// Reason 是机器可读的判别串，**只在 429 / 422 出现**。
	Reason string
	// Extra 是附加字段（目前只有 429 的 limit / used / resets_at）。
	Extra map[string]any
}

func (e *APIError) Error() string { return e.Message }

// 与 moyan-backend 的 AppError 变体一一对应（`error.rs:33-52`）。

func Unauthorized(msg string) *APIError {
	return &APIError{Status: http.StatusUnauthorized, Message: msg}
}

func BadRequest(msg string) *APIError {
	return &APIError{Status: http.StatusBadRequest, Message: msg}
}

func NotFound(msg string) *APIError {
	return &APIError{Status: http.StatusNotFound, Message: msg}
}

func ServiceUnavailable(msg string) *APIError {
	return &APIError{Status: http.StatusServiceUnavailable, Message: msg}
}

// Internal 的 message 永远不下发——上游错误可能含连接串等敏感信息（§13）。
// 细节只进日志。
func Internal(err error) *APIError {
	slog.Error("internal error", "err", err)
	return &APIError{Status: http.StatusInternalServerError, Message: "Internal server error"}
}

func Repository(err error) *APIError {
	slog.Error("repository error", "err", err)
	return &APIError{Status: http.StatusInternalServerError, Message: "Database error"}
}

// QuotaExceeded 对应 `error.rs:66-77`，带 limit / used / resets_at 供 App 展示。
// reason 由 `coach_quota_exceeded` 改名为 `rehearse_quota_exceeded`（§7.6）。
func QuotaExceeded(limit, used uint32, resetsAt string) *APIError {
	return &APIError{
		Status:  http.StatusTooManyRequests,
		Message: "Daily rehearse quota exceeded",
		Reason:  "rehearse_quota_exceeded",
		Extra: map[string]any{
			"limit":     limit,
			"used":      used,
			"resets_at": resetsAt,
		},
	}
}

// Unprocessable 对应 `error.rs:79-85`（422，如 vision_not_supported）。
func Unprocessable(reason, message string) *APIError {
	return &APIError{Status: http.StatusUnprocessableEntity, Message: message, Reason: reason}
}

// Envelope 把错误渲染成 `(HTTP 状态码, 响应体)`。
//
// 形状（`error.rs:109-117`）：
//
//	{"success":false,"error":{"code":<数字>,"message":"..."}}
//
// 带 reason 时（429 / 422）额外多一个 `reason` 键。
func Envelope(err error) (int, map[string]any) {
	apiErr, ok := err.(*APIError)
	if !ok {
		apiErr = Internal(err)
	}

	inner := map[string]any{
		"code":    apiErr.Status, // 数字，不是字符串
		"message": apiErr.Message,
	}
	if apiErr.Reason != "" {
		inner["reason"] = apiErr.Reason
	}
	for key, value := range apiErr.Extra {
		inner[key] = value
	}
	return apiErr.Status, map[string]any{"success": false, "error": inner}
}

// DataEnvelope 是成功信封：`{success:true, data:...}`（`error.rs:140-145`）。
func DataEnvelope(data any) map[string]any {
	return map[string]any{"success": true, "data": data}
}

// ImportFailedEnvelope 是唯一一个信封形状不同的分支（`error.rs:86-92`）：
// 键名是 **`errors`**（复数、无 `error` 外层）。
//
// ⚠️ Rehearse 目前**没有任何端点用它**——导入能力留在墨言侧。留着是为了
// §7.6 那张「信封逐字段对齐」的表是完整的：将来真加导入端点时，
// 形状已经在这里定死，不用回头翻 Rust。
func ImportFailedEnvelope(items any) (int, map[string]any) {
	return http.StatusBadRequest, map[string]any{"success": false, "errors": items}
}

// Abort 写错误信封并**中止**后续 handler。
//
// 用 `AbortWithStatusJSON` 而不是 `JSON`：中间件里用后者的话，请求会继续
// 走到业务 handler，于是「401 之后再写一个 200」——Go 只保留第一个状态码，
// 表现是响应体被覆盖，很难查。
func Abort(c *gin.Context, err error) {
	status, body := Envelope(err)
	c.AbortWithStatusJSON(status, body)
}

// OK 写成功信封。
func OK(c *gin.Context, data any) {
	c.JSON(http.StatusOK, DataEnvelope(data))
}
