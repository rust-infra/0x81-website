// Package middleware 提供 HTTP 层的横切能力：错误信封与 JWT 验签。
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
package middleware

import (
	"encoding/json"
	"log/slog"
	"net/http"
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

// WriteData 写成功响应：`{success:true, data:...}`（`error.rs:140-145`）。
func WriteData(w http.ResponseWriter, status int, data any) {
	writeJSON(w, status, map[string]any{"success": true, "data": data})
}

// WriteError 写失败响应。
//
// 形状（`error.rs:109-117`）：
//
//	{"success":false,"error":{"code":<数字>,"message":"..."}}
//
// 带 reason 时（429 / 422）额外多一个 `reason` 键。
func WriteError(w http.ResponseWriter, err error) {
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

	writeJSON(w, apiErr.Status, map[string]any{"success": false, "error": inner})
}

// WriteImportFailed 是唯一一个信封形状不同的分支（`error.rs:86-92`）：
// 键名是 **`errors`**（复数、无 `error` 外层）。导入失败要一次返回多条逐行错误。
func WriteImportFailed(w http.ResponseWriter, items any) {
	writeJSON(w, http.StatusBadRequest, map[string]any{"success": false, "errors": items})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		// 头已经发出去了，改不了状态码，只能记日志。
		slog.Error("failed to encode response", "err", err)
	}
}
