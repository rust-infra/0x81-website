package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func okSettings(server *httptest.Server) Settings {
	return Settings{BaseURL: server.URL, APIKey: "sk-test", Model: "test-model"}
}

func TestChatJSON_SendsExpectedRequest(t *testing.T) {
	var gotAuth string
	var gotBody map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/chat/completions", r.URL.Path, "路径")
		gotAuth = r.Header.Get("Authorization")
		raw, _ := io.ReadAll(r.Body)
		assert.NoError(t, json.Unmarshal(raw, &gotBody), "请求体不是合法 JSON")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"  {\"reply\":\"hi\"}  "}}]}`))
	}))
	defer server.Close()

	got, err := New().ChatJSON(context.Background(), okSettings(server),
		"system rules", "user text", 3000)
	require.NoError(t, err, "不该报错")

	// 返回值要 trim——模型经常带前后空白，不 trim 会让 JSON 解析失败。
	assert.Equal(t, `{"reply":"hi"}`, got, "content 期望已 trim")
	assert.Equal(t, "Bearer sk-test", gotAuth, "Authorization")
	assert.Equal(t, "test-model", gotBody["model"], "model")
	// 要显式要求 JSON 输出，否则模型可能返回带解释的散文。
	format, _ := gotBody["response_format"].(map[string]any)
	assert.Equal(t, "json_object", format["type"], "response_format.type")
	messages, _ := gotBody["messages"].([]any)
	require.Len(t, messages, 2, "messages 数量")
	first, _ := messages[0].(map[string]any)
	second, _ := messages[1].(map[string]any)
	// system 走 system 角色、用户内容走 user 角色——这是注入防线的一部分。
	assert.Equal(t, "system", first["role"], "第一条消息 role")
	assert.Equal(t, "system rules", first["content"], "第一条消息 content")
	assert.Equal(t, "user", second["role"], "第二条消息 role")
	assert.Equal(t, "user text", second["content"], "第二条消息 content")
	assert.Equal(t, float64(3000), gotBody["max_tokens"], "max_tokens")
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
			require.ErrorIs(t, err, ErrNotConfigured, "期望 ErrNotConfigured")
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
	require.ErrorAs(t, err, &upstream, "期望 *ErrUpstream")
	assert.Equal(t, http.StatusTooManyRequests, upstream.StatusCode, "StatusCode")
	// 详情要带出来供日志排查
	assert.Contains(t, upstream.Detail, "rate limited", "Detail 丢了上游信息")
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
	require.ErrorAs(t, err, &upstream, "期望 *ErrUpstream")
	assert.LessOrEqual(t, len([]rune(upstream.Detail)), maxDetailChars, "Detail 应当截断")
}

func TestChatJSON_UnparseableResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`this is not json at all`))
	}))
	defer server.Close()

	_, err := New().ChatJSON(context.Background(), okSettings(server), "s", "u", 100)
	var upstream *ErrUpstream
	require.ErrorAs(t, err, &upstream, "期望 *ErrUpstream")
	assert.Contains(t, upstream.Detail, "parse failed", "Detail")
}

// choices 为空也是上游异常，不能返回空字符串让调用方以为成功了。
func TestChatJSON_NoChoices(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[]}`))
	}))
	defer server.Close()

	_, err := New().ChatJSON(context.Background(), okSettings(server), "s", "u", 100)
	require.Error(t, err, "没有 choices 应当报错")
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
	_, err := New().ChatJSON(context.Background(), settings, "s", "u", 100)
	require.NoError(t, err, "不该报错")
	assert.Equal(t, "/chat/completions", gotPath, "路径")
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

	_, err := New().ChatJSON(ctx, okSettings(server), "s", "u", 100)
	require.Error(t, err, "已取消的 context 应当报错")
}

func TestSettingsConfigured(t *testing.T) {
	assert.True(t, (Settings{BaseURL: "a", APIKey: "b", Model: "c"}).Configured(), "三项齐全应当算已配置")
	assert.False(t, (Settings{BaseURL: "a", APIKey: "b"}).Configured(), "缺 model 不算已配置")
}

// rewriteTransport 把请求改投到本地测试服务器。
//
// 用途：`opencodeHeaders` 是拿 `settings.BaseURL` 判断的，所以要断言
// 「发往 OpenCode 网关时确实带了那三个头」，必须让 BaseURL 保持 opencode 的
// 形状、同时把流量引到 httptest——不能真的发网络请求。
type rewriteTransport struct{ target string }

func (t rewriteTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r.URL.Scheme = "http"
	r.URL.Host = strings.TrimPrefix(t.target, "http://")
	return http.DefaultTransport.RoundTrip(r)
}

// OpenCode 网关要 `x-opencode-session` 才路由（缺了回 400 MissingSessionID），
// 而普通 OpenAI-compatible 端点不该收到这三个自定义头。
// 对照 Rust 的 `llm_client.rs:824-840`。
func TestChatJSON_OpencodeHeadersOnlyForOpencodeGateway(t *testing.T) {
	for name, tc := range map[string]struct {
		baseURL string
		want    bool
	}{
		"opencode 网关":  {"https://opencode.ai/zen/go/v1", true},
		"匹配大小写不敏感":     {"https://OpenCode.AI/zen/go/v1", true},
		"普通 OpenAI 端点": {"https://api.openai.com/v1", false},
	} {
		t.Run(name, func(t *testing.T) {
			var got http.Header
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				got = r.Header.Clone()
				_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
			}))
			defer server.Close()

			client := &Client{http: &http.Client{Transport: rewriteTransport{server.URL}}}
			settings := Settings{BaseURL: tc.baseURL, APIKey: "sk-test", Model: "m"}
			_, err := client.ChatJSON(context.Background(), settings, "s", "u", 100)
			require.NoError(t, err, "不该报错")

			for _, header := range []string{"x-opencode-session", "x-opencode-request", "x-opencode-client"} {
				if tc.want {
					assert.NotEmpty(t, got.Get(header), "%s 缺失", header)
					continue
				}
				assert.Empty(t, got.Get(header), "%s 不该出现在非 OpenCode 端点上", header)
			}
			if !tc.want {
				return
			}
			assert.Equal(t, "rehearse-backend", got.Get("x-opencode-client"), "client 标识")
			// Rust 用 `Uuid::new_v4().simple()`：32 位十六进制、不带连字符。
			assert.Regexp(t, `^[0-9a-f]{32}$`, got.Get("x-opencode-session"), "session id 形状")
			assert.Regexp(t, `^[0-9a-f]{32}$`, got.Get("x-opencode-request"), "request id 形状")
			// 两个 id 必须是各自独立的随机值，不能是同一个。
			assert.NotEqual(t, got.Get("x-opencode-session"), got.Get("x-opencode-request"),
				"session 与 request id 不该相同")
		})
	}
}
