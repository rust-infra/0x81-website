// Package llm 是 OpenAI-compatible chat completions 客户端。
//
// 只实现通用 chat 那部分（§7.9 的对照表：`llm_client.rs` 有 894 行，
// 但 Rehearse 只用其中约 1/3）。**不做的事**：图像输入、音频转写、
// 视频摘要、OpenCode 专有头、播客采集的代理链路。
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Settings 是 LLM 配置。
//
// 权威来源是 DB 里的 `rehearse_settings`，env 只作兜底（§7.3.2）。
type Settings struct {
	BaseURL string
	APIKey  string
	Model   string
}

// Configured 判断三项是否都填了。任一为空就视为未配置。
func (s Settings) Configured() bool {
	return strings.TrimSpace(s.BaseURL) != "" &&
		strings.TrimSpace(s.APIKey) != "" &&
		strings.TrimSpace(s.Model) != ""
}

// ErrNotConfigured 对应 Rust 的 `ensure_configured` 失败——
// 客户端看到的是 **503** `AI service is not configured`。
//
// ⚠️ 这个检查必须在**扣额度之前**做（Rust 的顺序是
// `ensure_configured` → `quota.consume`）。反过来的话，服务没配好时
// 用户会白白损失一次额度，而且拿不到任何结果。
var ErrNotConfigured = errors.New("AI service is not configured")

// ErrUpstream 是「请求根本没成功」——网络失败、非 2xx、响应无法解析。
//
// ⚠️ 调用方（coach 层）应当把它**统一转成 503**
// `AI coach is temporarily unavailable`，不要透出底层细节：
// 上游的响应体里可能有配额信息、账号标识之类的东西（§13）。
type ErrUpstream struct {
	StatusCode int
	Detail     string
}

func (e *ErrUpstream) Error() string {
	return fmt.Sprintf("llm upstream error (status=%d): %s", e.StatusCode, e.Detail)
}

// 与 Rust 侧一致：300 秒。LLM 生成 3000 token 有时确实要一两分钟。
const requestTimeout = 300 * time.Second

// 错误信息里回显的响应体上限。Rust 是 300 字（非 2xx）/ 240 字（解析失败），
// 这里统一用 300——差别没有意义，而统一少一个常量。
const maxDetailChars = 300

// Client 是 LLM 客户端。
type Client struct {
	http *http.Client
}

// New 建一个客户端。
//
// ⚠️ 这里**不复用 http.DefaultClient**：默认客户端没有超时，
// 一个卡住的 LLM 请求会把 goroutine 永久挂住。
func New() *Client {
	return &Client{
		http: &http.Client{Timeout: requestTimeout},
	}
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model          string          `json:"model"`
	Messages       []chatMessage   `json:"messages"`
	MaxTokens      int             `json:"max_tokens,omitempty"`
	ResponseFormat *responseFormat `json:"response_format,omitempty"`
	Temperature    *float64        `json:"temperature,omitempty"`
}

type responseFormat struct {
	Type string `json:"type"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

// ChatJSON 发一次对话请求，返回模型输出的原始文本。
//
// 返回的是**原始文本**而不是解析后的结构：解析与容错（去掉 markdown 围栏、
// 解析失败走降级）属于 coach 层，客户端只管把文本拿回来。
//
// 要求 JSON 输出（`response_format: json_object`），但**不能依赖它**——
// 模型仍会时不时包上 markdown 围栏，所以调用方必须容错。
func (c *Client) ChatJSON(
	ctx context.Context,
	settings Settings,
	system, user string,
	maxTokens int,
) (string, error) {
	if !settings.Configured() {
		return "", ErrNotConfigured
	}

	body, err := json.Marshal(chatRequest{
		Model: settings.Model,
		Messages: []chatMessage{
			{Role: "system", Content: system},
			{Role: "user", Content: user},
		},
		MaxTokens:      maxTokens,
		ResponseFormat: &responseFormat{Type: "json_object"},
	})
	if err != nil {
		return "", fmt.Errorf("marshal chat request: %w", err)
	}

	url := strings.TrimRight(strings.TrimSpace(settings.BaseURL), "/") + "/chat/completions"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("build chat request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(settings.APIKey))

	response, err := c.http.Do(request)
	if err != nil {
		// 不把 err 直接当 Detail：它可能含完整 URL（含 query 里的凭据）。
		return "", &ErrUpstream{StatusCode: 0, Detail: "request failed: " + err.Error()}
	}
	defer response.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return "", &ErrUpstream{StatusCode: response.StatusCode, Detail: "read body failed"}
	}

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", &ErrUpstream{
			StatusCode: response.StatusCode,
			Detail:     truncate(string(raw), maxDetailChars),
		}
	}

	var parsed chatResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", &ErrUpstream{
			StatusCode: response.StatusCode,
			Detail:     "response parse failed: " + truncate(string(raw), maxDetailChars),
		}
	}

	if len(parsed.Choices) == 0 {
		return "", &ErrUpstream{
			StatusCode: response.StatusCode,
			Detail:     "response had no choices",
		}
	}
	return strings.TrimSpace(parsed.Choices[0].Message.Content), nil
}

func truncate(value string, max int) string {
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return string(runes[:max])
}
