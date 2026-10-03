package llm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// 对齐 Rust 的 `content_parts_put_text_first_then_images_with_high_detail`
// （`interview_ocr.rs:133`）。
func TestBuildContentPartsPutsTextFirstThenImagesWithHighDetail(t *testing.T) {
	images := []ImagePart{
		{MediaType: "image/jpeg", DataBase64: "AAA"},
		{MediaType: "image/jpeg", DataBase64: "BBB"},
	}
	parts := buildContentParts("transcribe this", images)
	if len(parts) != 3 {
		t.Fatalf("parts 数量 = %d，期望 3", len(parts))
	}
	if parts[0].Type != "text" || parts[0].Text != "transcribe this" {
		t.Fatalf("第一段 = %+v，期望 text", parts[0])
	}
	if parts[1].ImageURL == nil || parts[1].ImageURL.URL != "data:image/jpeg;base64,AAA" {
		t.Fatalf("第二段 = %+v", parts[1])
	}
	// detail 必须是 high：low 会丢小字，简历/JD 的识别会不可靠。
	if parts[1].ImageURL.Detail != "high" {
		t.Fatalf("detail = %q，期望 high", parts[1].ImageURL.Detail)
	}
	if parts[2].ImageURL == nil || parts[2].ImageURL.URL != "data:image/jpeg;base64,BBB" {
		t.Fatalf("第三段 = %+v", parts[2])
	}
}

// 对齐 Rust 的 `validates_image_count_type_and_size`（`interview_ocr.rs:180`）。
func TestValidateImages(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString(make([]byte, 8))
	build := func(count int, mediaType string, size int) []ImagePart {
		data := base64.StdEncoding.EncodeToString(make([]byte, size))
		out := make([]ImagePart, 0, count)
		for range count {
			out = append(out, ImagePart{MediaType: mediaType, DataBase64: data})
		}
		return out
	}

	if err := ValidateImages(build(1, "image/jpeg", 8)); err != nil {
		t.Fatalf("单张合法图片不该报错：%v", err)
	}
	if err := ValidateImages(build(6, "image/jpeg", 8)); err == nil {
		t.Fatal("超过 5 张应当报错")
	}
	if err := ValidateImages(build(1, "application/pdf", 8)); err == nil {
		t.Fatal("非 image/* 应当报错")
	}
	if err := ValidateImages(build(1, "image/jpeg", MaxImageBytes+1)); err == nil {
		t.Fatal("单张超过 1MB 应当报错")
	}
	if err := ValidateImages(nil); err == nil {
		t.Fatal("空列表应当报错")
	}
	if err := ValidateImages([]ImagePart{{MediaType: "image/png", DataBase64: "!!!not base64!!!"}}); err == nil {
		t.Fatal("非法 base64 应当报错")
	}
	// 总量 4MB 上限：3 张各 1MB 通过，5 张各 1MB 不通过。
	if err := ValidateImages(build(3, "image/png", MaxImageBytes)); err != nil {
		t.Fatalf("总量 3MB 应当通过：%v", err)
	}
	if err := ValidateImages(build(5, "image/png", MaxImageBytes)); err == nil {
		t.Fatal("总量 5MB 应当报错")
	}
	_ = encoded
}

// 对齐 Rust 的 `vision_unsupported_hint_matches_upstream_wording`（`interview_ocr.rs:154`）。
func TestVisionUnsupportedHintMatchesUpstreamWording(t *testing.T) {
	if !VisionUnsupportedHint("LLM error (400 Bad Request): model does not support image input") {
		t.Error("应当识别为「模型不支持视觉」")
	}
	if !VisionUnsupportedHint("invalid content type: vision not supported") {
		t.Error("应当识别为「模型不支持视觉」")
	}
	if VisionUnsupportedHint("LLM error (429): rate limited") {
		t.Error("限流不该被误判成视觉不支持")
	}
	if VisionUnsupportedHint("invalid api key") {
		t.Error("密钥错误不该被误判成视觉不支持")
	}
}

// 带图片的请求：content 是数组，且必须走同一套 body 构造。
func TestChatJSONWithImagesSendsContentParts(t *testing.T) {
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &gotBody); err != nil {
			t.Errorf("请求体不是合法 JSON: %v", err)
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"text\":\"hi\"}"}}]}`))
	}))
	defer server.Close()

	images := []ImagePart{{MediaType: "image/jpeg", DataBase64: "AAA"}}
	got, err := New().ChatJSONWithImages(
		context.Background(), okSettings(server), "sys", "transcribe", images, 4000)
	if err != nil {
		t.Fatalf("不该报错：%v", err)
	}
	if got != `{"text":"hi"}` {
		t.Fatalf("content = %q", got)
	}

	messages, _ := gotBody["messages"].([]any)
	user, _ := messages[1].(map[string]any)
	parts, ok := user["content"].([]any)
	if !ok {
		t.Fatalf("content 应当是数组，得到 %T", user["content"])
	}
	if len(parts) != 2 {
		t.Fatalf("parts 数量 = %d，期望 2", len(parts))
	}
	first, _ := parts[0].(map[string]any)
	if first["type"] != "text" {
		t.Fatalf("第一段 = %v，期望 text", first)
	}
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
		if _, err := New().ChatJSON(context.Background(), settings, "s", "u", 100); err != nil {
			t.Fatalf("不该报错：%v", err)
		}
		server.Close()

		value, present := gotBody["temperature"]
		if !present {
			t.Fatalf("temperature=%v 时请求体里没有这个字段（omitempty 把 0 吃掉了）", temperature)
		}
		// float32 → JSON 文本 → float64 会丢精度，用容差比较。
		got, ok := value.(float64)
		if !ok {
			t.Fatalf("temperature 不是数字：%T", value)
		}
		if diff := got - float64(temperature); diff > 1e-6 || diff < -1e-6 {
			t.Fatalf("temperature = %v，期望 %v", got, temperature)
		}
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
		if _, err := New().ChatJSON(context.Background(), settings, "s", "u", 100); err != nil {
			t.Fatalf("不该报错：%v", err)
		}
		server.Close()

		value, present := gotBody["reasoning_effort"]
		if wantEffort {
			if !present || value != "none" {
				t.Fatalf("model=%q 时 reasoning_effort = %v（present=%v），期望 none", model, value, present)
			}
		} else if present {
			t.Fatalf("model=%q 不该带 reasoning_effort，得到 %v", model, value)
		}
	}
}

// 超时设置要真的在客户端上，不能退回没有超时的 http.DefaultClient。
func TestNewUsesClientWithTimeout(t *testing.T) {
	client := New()
	if client.http.Timeout <= 0 {
		t.Fatal("客户端必须有超时，否则卡住的 LLM 请求会永久挂住 goroutine")
	}
	if !strings.Contains(client.http.Timeout.String(), "5m0s") {
		t.Fatalf("超时 = %v，期望 5m", client.http.Timeout)
	}
}
