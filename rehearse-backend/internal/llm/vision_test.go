package llm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 对齐 Rust 的 `content_parts_put_text_first_then_images_with_high_detail`
// （`interview_ocr.rs:133`）。
func TestBuildContentPartsPutsTextFirstThenImagesWithHighDetail(t *testing.T) {
	images := []ImagePart{
		{MediaType: "image/jpeg", DataBase64: "AAA"},
		{MediaType: "image/jpeg", DataBase64: "BBB"},
	}
	parts := buildContentParts("transcribe this", images)
	require.Len(t, parts, 3, "parts 数量")
	require.Equal(t, "text", parts[0].Type, "第一段 type")
	require.Equal(t, "transcribe this", parts[0].Text, "第一段 text")
	require.NotNil(t, parts[1].ImageURL, "第二段 ImageURL")
	require.Equal(t, "data:image/jpeg;base64,AAA", parts[1].ImageURL.URL, "第二段 URL")
	// detail 必须是 high：low 会丢小字，简历/JD 的识别会不可靠。
	require.Equal(t, "high", parts[1].ImageURL.Detail, "detail")
	require.NotNil(t, parts[2].ImageURL, "第三段 ImageURL")
	require.Equal(t, "data:image/jpeg;base64,BBB", parts[2].ImageURL.URL, "第三段 URL")
}

// 对齐 Rust 的 `validates_image_count_type_and_size`（`interview_ocr.rs:180`）。
func TestValidateImages(t *testing.T) {
	build := func(count int, mediaType string, size int) []ImagePart {
		data := base64.StdEncoding.EncodeToString(make([]byte, size))
		out := make([]ImagePart, 0, count)
		for range count {
			out = append(out, ImagePart{MediaType: mediaType, DataBase64: data})
		}
		return out
	}

	err := ValidateImages(build(1, "image/jpeg", 8))
	require.NoError(t, err, "单张合法图片不该报错")
	err = ValidateImages(build(6, "image/jpeg", 8))
	require.Error(t, err, "超过 5 张应当报错")
	err = ValidateImages(build(1, "application/pdf", 8))
	require.Error(t, err, "非 image/* 应当报错")
	err = ValidateImages(build(1, "image/jpeg", MaxImageBytes+1))
	require.Error(t, err, "单张超过 1MB 应当报错")
	err = ValidateImages(nil)
	require.Error(t, err, "空列表应当报错")
	err = ValidateImages([]ImagePart{{MediaType: "image/png", DataBase64: "!!!not base64!!!"}})
	require.Error(t, err, "非法 base64 应当报错")
	// 总量 4MB 上限：3 张各 1MB 通过，5 张各 1MB 不通过。
	err = ValidateImages(build(3, "image/png", MaxImageBytes))
	require.NoError(t, err, "总量 3MB 应当通过")
	err = ValidateImages(build(5, "image/png", MaxImageBytes))
	require.Error(t, err, "总量 5MB 应当报错")
}

// 对齐 Rust 的 `vision_unsupported_hint_matches_upstream_wording`（`interview_ocr.rs:154`）。
func TestVisionUnsupportedHintMatchesUpstreamWording(t *testing.T) {
	assert.True(t, VisionUnsupportedHint("LLM error (400 Bad Request): model does not support image input"),
		"应当识别为「模型不支持视觉」")
	assert.True(t, VisionUnsupportedHint("invalid content type: vision not supported"),
		"应当识别为「模型不支持视觉」")
	assert.False(t, VisionUnsupportedHint("LLM error (429): rate limited"),
		"限流不该被误判成视觉不支持")
	assert.False(t, VisionUnsupportedHint("invalid api key"),
		"密钥错误不该被误判成视觉不支持")
}

// 带图片的请求：content 是数组，且必须走同一套 body 构造。
func TestChatJSONWithImagesSendsContentParts(t *testing.T) {
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		assert.NoError(t, json.Unmarshal(raw, &gotBody), "请求体不是合法 JSON")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"text\":\"hi\"}"}}]}`))
	}))
	defer server.Close()

	images := []ImagePart{{MediaType: "image/jpeg", DataBase64: "AAA"}}
	got, err := New().ChatJSONWithImages(
		context.Background(), okSettings(server), "sys", "transcribe", images, 4000)
	require.NoError(t, err, "不该报错")
	require.Equal(t, `{"text":"hi"}`, got, "content")

	messages, _ := gotBody["messages"].([]any)
	user, _ := messages[1].(map[string]any)
	parts, ok := user["content"].([]any)
	require.Truef(t, ok, "content 应当是数组，得到 %T", user["content"])
	require.Len(t, parts, 2, "parts 数量")
	first, _ := parts[0].(map[string]any)
	require.Equal(t, "text", first["type"], "第一段 type")
}

// temperature 必须随请求发出，且 0 不能被 omitempty 吞掉。
func TestChatJSONAlwaysSendsTemperature(t *testing.T) {
	for _, temperature := range []float32{0, 0.3} {
		var gotBody map[string]any
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &gotBody)
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
		}))

		settings := okSettings(server)
		settings.Temperature = temperature
		_, err := New().ChatJSON(context.Background(), settings, "s", "u", 100)
		require.NoError(t, err, "不该报错")
		server.Close()

		value, present := gotBody["temperature"]
		require.Truef(t, present,
			"temperature=%v 时请求体里没有这个字段（omitempty 把 0 吃掉了）", temperature)
		// float32 → JSON 文本 → float64 会丢精度，用容差比较。
		got, ok := value.(float64)
		require.Truef(t, ok, "temperature 不是数字：%T", value)
		require.InDeltaf(t, float64(temperature), got, 1e-6, "temperature")
	}
}

// DeepSeek 要带 reasoning_effort=none，其他模型不带（Rust `llm_client.rs:526`）。
func TestChatJSONReasoningEffortOnlyForDeepSeek(t *testing.T) {
	cases := map[string]bool{
		"deepseek-flash":    true,
		"DeepSeek-Chat":     true,
		"gpt-4o-mini":       false,
		"claude-3-5-sonnet": false,
	}
	for model, wantEffort := range cases {
		var gotBody map[string]any
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &gotBody)
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
		}))

		settings := okSettings(server)
		settings.Model = model
		_, err := New().ChatJSON(context.Background(), settings, "s", "u", 100)
		require.NoError(t, err, "不该报错")
		server.Close()

		value, present := gotBody["reasoning_effort"]
		if wantEffort {
			require.Truef(t, present && value == "none",
				"model=%q 时 reasoning_effort = %v（present=%v），期望 none", model, value, present)
		} else {
			require.Falsef(t, present, "model=%q 不该带 reasoning_effort，得到 %v", model, value)
		}
	}
}

// 超时设置要真的在客户端上，不能退回没有超时的 http.DefaultClient。
func TestNewUsesClientWithTimeout(t *testing.T) {
	client := New()
	require.Positive(t, client.http.Timeout,
		"客户端必须有超时，否则卡住的 LLM 请求会永久挂住 goroutine")
	assert.Contains(t, client.http.Timeout.String(), "5m0s", "超时应当为 5m")
}
