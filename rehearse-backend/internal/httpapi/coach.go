package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/0x81/rehearse-backend/internal/coach"
	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/0x81/rehearse-backend/internal/model"
)

// 本文件是 `/api/rehearse/*` 的用户侧接口（§7.5 的路由表）。
//
// 移植自 `moyan-backend/src/controllers/coach.rs`（162 行），
// 目标文件是设计稿 §7.9 指定的 `internal/httpapi/coach.go`。
//
// 这一层只做三件事：取 claims、解请求体、把结果包进信封。**所有业务判断
// 都在 `internal/coach` 里**——包括「什么时候扣额度」「什么算非法输入」，
// 那些顺序是护栏的一部分，不该散在 HTTP 层。

// maxJSONBodyBytes 是 JSON 请求体的上限。
//
// 与 axum 的 `DefaultBodyLimit` 默认值一致（2 MiB）。业务上限比它小得多
// （最宽的 `history + user_text` 是 12 000 字符），这一层只是防止有人拿
// 一个 1 GB 的 body 把内存撑爆——**字符数校验拦不住这个**，它要先读完。
const maxJSONBodyBytes = 2 * 1024 * 1024

// decodeJSON 解请求体。
//
// ⚠️ 解析失败统一回 **400 + 信封**。上游在同类错误上有两种表现
// （serde 枚举拒绝 → 422 纯文本；`check_enum` → 400 信封），详见
// `internal/coach/guards.go` 顶部的说明。这里保持信封一致。
func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(target); err != nil {
		return middleware.BadRequest("invalid request body: " + err.Error())
	}
	return nil
}

// requireClaims 取验签中间件注入的 claims。
//
// 取不到只可能是路由没挂 `RequireAuth`——装配错误，回 500 而不是 401，
// 免得把它伪装成「用户没登录」。
func requireClaims(w http.ResponseWriter, r *http.Request) (*middleware.Claims, bool) {
	claims, ok := middleware.ClaimsFrom(r.Context())
	if !ok {
		middleware.WriteError(w, middleware.Internal(errMissingClaims))
		return nil, false
	}
	return claims, true
}

// quotaResponse 是 `GET /api/rehearse/quota` 的响应（`controllers/coach.rs:35-45`）。
//
// 比 `coach.QuotaSnapshot` 多一个 `llm_configured`：那个字段要看 LLM 配置，
// 属于两个服务的组合，所以由 HTTP 层拼——配额服务不该知道 LLM 的存在。
type quotaResponse struct {
	Limit     uint32  `json:"limit"`
	Used      uint32  `json:"used"`
	Remaining *uint32 `json:"remaining"`
	ResetsAt  string  `json:"resets_at"`
	Enabled   bool    `json:"enabled"`
	// LLMConfigured 让 App 在服务端还没配好模型时给出准确提示，
	// 而不是等用户点了「开始」再收到一个 503。
	LLMConfigured bool `json:"llm_configured"`
}

func quotaHandler(quota *coach.QuotaService, llmSettings *coach.LLMSettingsService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := requireClaims(w, r)
		if !ok {
			return
		}
		snapshot, err := quota.Snapshot(r.Context(), claims.Sub)
		if err != nil {
			middleware.WriteError(w, err)
			return
		}
		resolved, err := llmSettings.Resolve(r.Context())
		if err != nil {
			middleware.WriteError(w, middleware.Repository(err))
			return
		}
		middleware.WriteData(w, http.StatusOK, quotaResponse{
			Limit:         snapshot.Limit,
			Used:          snapshot.Used,
			Remaining:     snapshot.Remaining,
			ResetsAt:      snapshot.ResetsAt,
			Enabled:       snapshot.Enabled,
			LLMConfigured: resolved.Configured(),
		})
	}
}

func turnHandler(service *coach.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := requireClaims(w, r)
		if !ok {
			return
		}
		var req model.TurnRequest
		if err := decodeJSON(w, r, &req); err != nil {
			middleware.WriteError(w, err)
			return
		}
		out, err := service.Turn(r.Context(), claims.Sub, req)
		if err != nil {
			middleware.WriteError(w, err)
			return
		}
		middleware.WriteData(w, http.StatusOK, out)
	}
}

// summaryHandler 不需要 user id：复盘不计额度、不写任何按用户的数据
// （`controllers/coach.rs:57-63` 同样不取 claims）。
//
// 它仍然在验签子树下——**鉴权**（这是谁）与**授权用不用得上**（拿 sub 做什么）
// 是两件事。
func summaryHandler(service *coach.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req model.SummaryRequest
		if err := decodeJSON(w, r, &req); err != nil {
			middleware.WriteError(w, err)
			return
		}
		out, err := service.Summary(r.Context(), req)
		if err != nil {
			middleware.WriteError(w, err)
			return
		}
		middleware.WriteData(w, http.StatusOK, out)
	}
}

func draftHandler(service *coach.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := requireClaims(w, r)
		if !ok {
			return
		}
		var req model.ScenarioDraftRequest
		if err := decodeJSON(w, r, &req); err != nil {
			middleware.WriteError(w, err)
			return
		}
		out, err := service.DraftScenario(r.Context(), claims.Sub, req)
		if err != nil {
			middleware.WriteError(w, err)
			return
		}
		middleware.WriteData(w, http.StatusOK, out)
	}
}
