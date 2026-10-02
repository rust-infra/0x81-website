package llm

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func okSettings(server *httptest.Server) Settings {
	return Settings{BaseURL: server.URL, APIKey: "sk-test", Model: "test-model"}
}

func TestChatJSON_SendsExpectedRequest(t *testing.T) {
	var gotAuth string
	var gotBody map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("路径 = %q, 期望 /chat/completions", r.URL.Path)
		}
		gotAuth = r.Header.Get("Authorization")
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &gotBody); err != nil {
			t.Errorf("请求体不是合法 JSON: %v", err)
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"  {\"reply\":\"hi\"}  "}}]}`))
	}))
	defer server.Close()

	got, err := New().ChatJSON(context.Background(), okSettings(server),
		"system rules", "user text", 3000)
	if err != nil {
		t.Fatalf("不该报错: %v", err)
	}

	// 返回值要 trim——模型经常带前后空白，不 trim 会让 JSON 解析失败。
	if got != `{"reply":"hi"}` {
		t.Errorf("content = %q, 期望已 trim", got)
	}
	if gotAuth != "Bearer sk-test" {
		t.Errorf("Authorization = %q", gotAuth)
	}
	if gotBody["model"] != "test-model" {
		t.Errorf("model = %v", gotBody["model"])
	}
	// 要显式要求 JSON 输出，否则模型可能返回带解释的散文。
	format, _ := gotBody["response_format"].(map[string]any)
	if format["type"] != "json_object" {
		t.Errorf("response_format = %v, 期望 json_object", gotBody["response_format"])
	}
	messages, _ := gotBody["messages"].([]any)
	if len(messages) != 2 {
		t.Fatalf("messages 数量 = %d, 期望 2", len(messages))
	}
	first, _ := messages[0].(map[string]any)
	second, _ := messages[1].(map[string]any)
	// system 走 system 角色、用户内容走 user 角色——这是注入防线的一部分。
	if first["role"] != "system" || first["content"] != "system rules" {
		t.Errorf("第一条消息不对: %v", first)
	}
	if second["role"] != "user" || second["content"] != "user text" {
		t.Errorf("第二条消息不对: %v", second)
	}
	if gotBody["max_tokens"] != float64(3000) {
		t.Errorf("max_tokens = %v", gotBody["max_tokens"])
	}
}

func TestChatJSON_NotConfigured(t *testing.T) {
	client := New()
	for name, settings := range map[string]Settings{
		"全空":      {},
		"缺 base":  {APIKey: "k", Model: "m"},
		"缺 key":   {BaseURL: "http://x", Model: "m"},
		"缺 model": {BaseURL: "http://x", APIKey: "k"},
		"只有空白":    {BaseURL: "  ", APIKey: "  ", Model: "  "},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := client.ChatJSON(context.Background(), settings, "s", "u", 100)
			if !errors.Is(err, ErrNotConfigured) {
				t.Fatalf("err = %v, 期望 ErrNotConfigured", err)
			}
		})
	}
	// 未配置时不该发任何请求——没有 server 也能过，说明确实没发。
}

func TestChatJSON_UpstreamNon2xx(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":"rate limited, account org-abc123"}`))
	}))
	defer server.Close()

	_, err := New().ChatJSON(context.Background(), okSettings(server), "s", "u", 100)
	var upstream *ErrUpstream
	if !errors.As(err, &upstream) {
		t.Fatalf("err = %v, 期望 *ErrUpstream", err)
	}
	if upstream.StatusCode != http.StatusTooManyRequests {
		t.Errorf("StatusCode = %d", upstream.StatusCode)
	}
	// 详情要带出来供日志排查
	if !strings.Contains(upstream.Detail, "rate limited") {
		t.Errorf("Detail 丢了上游信息: %q", upstream.Detail)
	}
}

// 上游返回超长内容时只截取前 300 字——完整响应体可能很大，
// 而且里面可能有不该外泄的东西。
func TestChatJSON_TruncatesLongErrorDetail(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(strings.Repeat("x", 5000)))
	}))
	defer server.Close()

	_, err := New().ChatJSON(context.Background(), okSettings(server), "s", "u", 100)
	var upstream *ErrUpstream
	if !errors.As(err, &upstream) {
		t.Fatalf("err = %v", err)
	}
	if got := len([]rune(upstream.Detail)); got > maxDetailChars {
		t.Errorf("Detail 长度 = %d, 应当截到 %d", got, maxDetailChars)
	}
}

func TestChatJSON_UnparseableResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`this is not json at all`))
	}))
	defer server.Close()

	_, err := New().ChatJSON(context.Background(), okSettings(server), "s", "u", 100)
	var upstream *ErrUpstream
	if !errors.As(err, &upstream) {
		t.Fatalf("err = %v, 期望 *ErrUpstream", err)
	}
	if !strings.Contains(upstream.Detail, "parse failed") {
		t.Errorf("Detail = %q", upstream.Detail)
	}
}

// choices 为空也是上游异常，不能返回空字符串让调用方以为成功了。
func TestChatJSON_NoChoices(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[]}`))
	}))
	defer server.Close()

	if _, err := New().ChatJSON(context.Background(), okSettings(server), "s", "u", 100); err == nil {
		t.Fatal("没有 choices 应当报错")
	}
}

func TestChatJSON_BaseURLTrailingSlashIsTolerated(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
	}))
	defer server.Close()

	settings := okSettings(server)
	settings.BaseURL = server.URL + "/" // 常见配置写法，不能拼成 //chat/completions
	if _, err := New().ChatJSON(context.Background(), settings, "s", "u", 100); err != nil {
		t.Fatalf("不该报错: %v", err)
	}
	if gotPath != "/chat/completions" {
		t.Errorf("路径 = %q, 期望 /chat/completions", gotPath)
	}
}

func TestChatJSON_RespectsContextCancellation(t *testing.T) {
	blocked := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-blocked:
		}
	}))
	defer server.Close()
	defer close(blocked)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // 立刻取消

	if _, err := New().ChatJSON(ctx, okSettings(server), "s", "u", 100); err == nil {
		t.Fatal("已取消的 context 应当报错")
	}
}

func TestSettingsConfigured(t *testing.T) {
	if (Settings{BaseURL: "a", APIKey: "b", Model: "c"}).Configured() != true {
		t.Error("三项齐全应当算已配置")
	}
	if (Settings{BaseURL: "a", APIKey: "b"}).Configured() != false {
		t.Error("缺 model 不算已配置")
	}
}
