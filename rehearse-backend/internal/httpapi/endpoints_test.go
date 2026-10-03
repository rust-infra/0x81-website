package httpapi

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"

	"github.com/0x81/rehearse-backend/internal/coach"
	"github.com/0x81/rehearse-backend/internal/config"
	"github.com/0x81/rehearse-backend/internal/llm"
	"github.com/0x81/rehearse-backend/internal/material"
	"github.com/0x81/rehearse-backend/internal/scenarios"
	"github.com/0x81/rehearse-backend/internal/store"
	"github.com/0x81/rehearse-backend/internal/store/storetest"
)

// 本文件验的是 HTTP 层自己的东西：信封形状、鉴权边界、请求体上限、
// multipart 解析。业务判断的用例在 internal/coach 里，不在这里重复。

// llmStub 是一个返回固定 content 的上游，供需要走模型的用例使用。
func llmStub(t *testing.T, content string) *llm.Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		payload, err := json.Marshal(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"content": content}}},
		})
		if err != nil {
			t.Errorf("marshal stub response: %v", err)
			return
		}
		_, _ = w.Write(payload)
	}))
	t.Cleanup(server.Close)
	testLLMBaseURL = server.URL
	return llm.New()
}

func depsWithLLM(t *testing.T, st store.Store, content string) Deps {
	t.Helper()
	catalog, err := scenarios.Load()
	if err != nil {
		t.Fatalf("load scenario catalog: %v", err)
	}
	client := llmStub(t, content)
	fallback := config.LLMFallback{BaseURL: testLLMBaseURL, APIKey: "sk-test", Model: "test-model"}
	quota := coach.NewQuotaService(st)
	llmSettings := coach.NewLLMSettingsService(st, fallback)
	return Deps{
		Config:      testConfig(),
		Store:       st,
		Catalog:     catalog,
		Coach:       coach.NewService(quota, llmSettings, catalog, client),
		Quota:       quota,
		LLMSettings: llmSettings,
		OCR:         material.NewOCRService(quota, llmSettings, client),
		Profile:     material.NewProfileService(quota, llmSettings, client),
	}
}

// request 是一次完整的 HTTP 请求描述。
type request struct {
	method        string
	path          string
	body          string
	authorization string
	adminToken    string
	origin        string
	contentType   string
}

func send(t *testing.T, handler http.Handler, req request) *httptest.ResponseRecorder {
	t.Helper()
	var body io.Reader
	if req.body != "" {
		body = strings.NewReader(req.body)
	}
	httpReq := httptest.NewRequest(req.method, req.path, body)
	if req.authorization != "" {
		httpReq.Header.Set("Authorization", req.authorization)
	}
	if req.adminToken != "" {
		httpReq.Header.Set("X-Admin-Token", req.adminToken)
	}
	if req.origin != "" {
		httpReq.Header.Set("Origin", req.origin)
	}
	if req.contentType != "" {
		httpReq.Header.Set("Content-Type", req.contentType)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httpReq)
	return rec
}

// envelope 解析成功信封，返回 data。
func envelope(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var parsed struct {
		Success bool           `json:"success"`
		Data    map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("响应不是合法 JSON：%v（body=%s）", err, rec.Body.String())
	}
	if !parsed.Success {
		t.Fatalf("success 应当为 true：%s", rec.Body.String())
	}
	return parsed.Data
}

// errorEnvelope 解析失败信封，返回 error 对象。
func errorEnvelope(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var parsed struct {
		Success bool           `json:"success"`
		Error   map[string]any `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("响应不是合法 JSON：%v（body=%s）", err, rec.Body.String())
	}
	if parsed.Success {
		t.Fatalf("success 应当为 false：%s", rec.Body.String())
	}
	return parsed.Error
}

// ---------------------------------------------------------------- 鉴权边界

// 用户接口不带 token 一律 401，且形状是信封（§7.6）。
func TestUserEndpointsRequireJWT(t *testing.T) {
	router := newTestRouter(t, storetest.New())
	paths := []request{
		{method: http.MethodGet, path: "/api/rehearse/quota"},
		{method: http.MethodPost, path: "/api/rehearse/turn", body: `{}`, contentType: "application/json"},
		{method: http.MethodPost, path: "/api/rehearse/summary", body: `{}`, contentType: "application/json"},
		{method: http.MethodPost, path: "/api/rehearse/scenario/draft", body: `{}`, contentType: "application/json"},
		{method: http.MethodPost, path: "/api/rehearse/material/profile", body: `{}`, contentType: "application/json"},
	}
	for _, req := range paths {
		rec := send(t, router, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s → %d，期望 401", req.method, req.path, rec.Code)
			continue
		}
		inner := errorEnvelope(t, rec)
		// ⚠️ code 是**数字**（HTTP 状态码），不是字符串枚举——规格里错过一次。
		if inner["code"] != float64(401) {
			t.Errorf("%s %s → code = %v，期望数字 401", req.method, req.path, inner["code"])
		}
		if inner["message"] != "Missing authorization token" {
			t.Errorf("%s %s → message = %v", req.method, req.path, inner["message"])
		}
	}
}

// ⚠️ 管理端只认 X-Admin-Token：一个**完全合法**的用户 JWT 不能换来管理权限。
// 这条如果挂了，任何登录用户都能改全局配额与 LLM 配置。
func TestAdminEndpointsRejectUserJWT(t *testing.T) {
	router := newTestRouter(t, storetest.New())
	rec := send(t, router, request{
		method:        http.MethodGet,
		path:          "/api/admin/settings/rehearse",
		authorization: "Bearer " + token(t, "active"),
	})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d，期望 401（用户 JWT 不该能进管理端）", rec.Code)
	}
	if inner := errorEnvelope(t, rec); inner["message"] != "Invalid admin token" {
		t.Fatalf("message = %v", inner["message"])
	}
}

// 反过来：管理端 token 也不该能进用户接口。
func TestUserEndpointsRejectAdminToken(t *testing.T) {
	router := newTestRouter(t, storetest.New())
	rec := send(t, router, request{
		method:     http.MethodGet,
		path:       "/api/rehearse/quota",
		adminToken: testAdminToken,
	})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d，期望 401", rec.Code)
	}
}

// 配置里没有 ADMIN_TOKEN 时，管理端回 503 而不是放行——放行等于把管理端
// 完全敞开（Rust `admin_auth.rs:8-14`）。
func TestAdminEndpointsServiceUnavailableWithoutConfiguredToken(t *testing.T) {
	deps := newTestDeps(t, storetest.New())
	deps.Config.AdminToken = ""
	router := NewRouter(deps)

	rec := send(t, router, request{method: http.MethodGet, path: "/api/admin/settings/rehearse"})
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d，期望 503", rec.Code)
	}
	if inner := errorEnvelope(t, rec); inner["message"] != "ADMIN_TOKEN is not configured" {
		t.Fatalf("message = %v", inner["message"])
	}
}

// ---------------------------------------------------------------- 用户接口

func TestQuotaReturnsSnapshotShape(t *testing.T) {
	router := newTestRouter(t, storetest.New())
	rec := send(t, router, request{
		method:        http.MethodGet,
		path:          "/api/rehearse/quota",
		authorization: "Bearer " + token(t, "active"),
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d，body = %s", rec.Code, rec.Body.String())
	}
	data := envelope(t, rec)
	for _, key := range []string{"limit", "used", "remaining", "resets_at", "enabled", "llm_configured"} {
		if _, ok := data[key]; !ok {
			t.Errorf("响应缺少 %q：%v", key, data)
		}
	}
	if data["limit"] != float64(coach.DefaultDailyTurnLimit) {
		t.Errorf("limit = %v，期望默认 %d", data["limit"], coach.DefaultDailyTurnLimit)
	}
	if data["llm_configured"] != true {
		t.Errorf("llm_configured = %v，期望 true（测试里配了 key）", data["llm_configured"])
	}
}

func TestTurnHappyPathAndEnvelope(t *testing.T) {
	const payload = `{"reply":"Nice!","mood":"curious","next_lines":[]}`
	router := NewRouter(depsWithLLM(t, storetest.New(), payload))

	rec := send(t, router, request{
		method:        http.MethodPost,
		path:          "/api/rehearse/turn",
		authorization: "Bearer " + token(t, "active"),
		contentType:   "application/json",
		body: `{"scenario":{"id":"s","source":"custom","category":"daily","language":"en-US",
			"title":"t","description":"d","persona":{"name":"A","role":"R","tone":"friendly"},
			"setting":"meeting","opening_line":"Hi","focus_points":[],"difficulty":"core","max_turns":6},
			"history":[],"user_text":"hello","mode":"feedback"}`,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d，body = %s", rec.Code, rec.Body.String())
	}
	data := envelope(t, rec)
	if data["reply"] != "Nice!" {
		t.Fatalf("reply = %v", data["reply"])
	}
	if data["turn_index"] != float64(1) {
		t.Fatalf("turn_index = %v", data["turn_index"])
	}
}

// 请求体不是合法 JSON → 400 信封（不是 500，也不是空 body）。
func TestMalformedBodyReturnsEnvelope(t *testing.T) {
	router := newTestRouter(t, storetest.New())
	rec := send(t, router, request{
		method:        http.MethodPost,
		path:          "/api/rehearse/turn",
		authorization: "Bearer " + token(t, "active"),
		contentType:   "application/json",
		body:          `{"scenario":`,
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d，期望 400", rec.Code)
	}
	if inner := errorEnvelope(t, rec); inner["code"] != float64(400) {
		t.Fatalf("code = %v", inner["code"])
	}
}

// 超过 JSON body 上限时也要是 400 信封，而不是连接被粗暴掐断。
func TestOversizedJSONBodyRejected(t *testing.T) {
	router := newTestRouter(t, storetest.New())
	huge := `{"user_text":"` + strings.Repeat("a", maxJSONBodyBytes+1) + `"}`
	rec := send(t, router, request{
		method:        http.MethodPost,
		path:          "/api/rehearse/turn",
		authorization: "Bearer " + token(t, "active"),
		contentType:   "application/json",
		body:          huge,
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d，期望 400", rec.Code)
	}
}

func TestSummaryHappyPath(t *testing.T) {
	const payload = `{"overall_zh":"不错","overall_en":"Good","strengths":["a"],"improvements":[],"expressions":[]}`
	router := NewRouter(depsWithLLM(t, storetest.New(), payload))

	rec := send(t, router, request{
		method:        http.MethodPost,
		path:          "/api/rehearse/summary",
		authorization: "Bearer " + token(t, "active"),
		contentType:   "application/json",
		body: `{"scenario":{"id":"s","source":"custom","category":"daily","language":"en-US",
			"title":"t","description":"d","persona":{"name":"A","role":"R","tone":"friendly"},
			"setting":"meeting","opening_line":"Hi","focus_points":[],"difficulty":"core","max_turns":6},
			"history":[{"role":"user","content":"hello"}]}`,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d，body = %s", rec.Code, rec.Body.String())
	}
	data := envelope(t, rec)
	if data["overall_en"] != "Good" {
		t.Fatalf("overall_en = %v", data["overall_en"])
	}
}

func TestDraftHappyPath(t *testing.T) {
	const payload = `{"category":"daily","title":"站会","description":"同步进度",` +
		`"persona":{"name":"Alex","role":"Tech Lead","accent":"en-US","tone":"friendly"},` +
		`"setting":"meeting","opening_line":"Morning!","opening_line_translation":"早！",` +
		`"opening_next_lines":[],"focus_points":[],"difficulty":"easy","max_turns":6}`
	router := NewRouter(depsWithLLM(t, storetest.New(), payload))

	rec := send(t, router, request{
		method:        http.MethodPost,
		path:          "/api/rehearse/scenario/draft",
		authorization: "Bearer " + token(t, "active"),
		contentType:   "application/json",
		body:          `{"description":"和澳洲同事交接任务"}`,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d，body = %s", rec.Code, rec.Body.String())
	}
	data := envelope(t, rec)
	if data["source"] != "custom" {
		t.Fatalf("source = %v", data["source"])
	}
	if id, _ := data["id"].(string); !strings.HasPrefix(id, "custom_") {
		t.Fatalf("id = %v", data["id"])
	}
}

// ---------------------------------------------------------------- 材料

// docxFixture 造一份最小的 .docx（就是一个含 word/document.xml 的 zip）。
func docxFixture(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	entry, err := archive.Create("word/document.xml")
	if err != nil {
		t.Fatal(err)
	}
	xml := `<w:body><w:p><w:r><w:t>Alice Chen</w:t></w:r></w:p>` +
		`<w:p><w:r><w:t>Backend Engineer</w:t></w:r></w:p></w:body>`
	if _, err := entry.Write([]byte(xml)); err != nil {
		t.Fatal(err)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

// part 是一个 multipart 字段。
type part struct {
	fileName string
	// contentType 只在文件字段上有意义。**必须显式给**：`CreateFormFile` 会
	// 写死 `application/octet-stream`，而图片校验要求 `image/*`——不给的话
	// 图片路径会被自己的校验挡掉，看起来像「视觉功能坏了」。
	contentType string
	content     []byte
}

// multipartBody 拼一个 multipart 请求体，返回 Content-Type 与 body。
func multipartBody(t *testing.T, fields map[string]part) (string, io.Reader) {
	t.Helper()
	var buffer bytes.Buffer
	writer := multipart.NewWriter(&buffer)
	for name, field := range fields {
		header := textproto.MIMEHeader{}
		header.Set("Content-Disposition",
			fmt.Sprintf(`form-data; name=%q; filename=%q`, name, field.fileName))
		if field.contentType != "" {
			header.Set("Content-Type", field.contentType)
		}
		part, err := writer.CreatePart(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(field.content); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return writer.FormDataContentType(), &buffer
}

func TestMaterialTextParsesDocx(t *testing.T) {
	router := newTestRouter(t, storetest.New())
	contentType, body := multipartBody(t, map[string]part{
		"docs": {fileName: "resume.docx", content: docxFixture(t)},
	})

	httpReq := httptest.NewRequest(http.MethodPost, "/api/rehearse/material/text", body)
	httpReq.Header.Set("Authorization", "Bearer "+token(t, "active"))
	httpReq.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httpReq)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d，body = %s", rec.Code, rec.Body.String())
	}
	data := envelope(t, rec)
	if data["text"] != "Alice Chen\nBackend Engineer" {
		t.Fatalf("text = %q", data["text"])
	}
	if data["source"] != "document" {
		t.Fatalf("source = %v", data["source"])
	}
	// 只有 28 个字符，低于 200 的阈值 → 提示可能是扫描件。
	if data["likely_scanned"] != true {
		t.Fatalf("likely_scanned = %v，期望 true", data["likely_scanned"])
	}
}

func TestMaterialTextRejectsUnknownExtension(t *testing.T) {
	router := newTestRouter(t, storetest.New())
	contentType, body := multipartBody(t, map[string]part{
		"docs": {fileName: "resume.txt", content: []byte("hello")},
	})

	httpReq := httptest.NewRequest(http.MethodPost, "/api/rehearse/material/text", body)
	httpReq.Header.Set("Authorization", "Bearer "+token(t, "active"))
	httpReq.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httpReq)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d，期望 400", rec.Code)
	}
}

// 既没有 docs 也没有 images → 400，且文案与 Rust 一致。
func TestMaterialTextRequiresDocsOrImages(t *testing.T) {
	router := newTestRouter(t, storetest.New())
	contentType, body := multipartBody(t, map[string]part{})

	httpReq := httptest.NewRequest(http.MethodPost, "/api/rehearse/material/text", body)
	httpReq.Header.Set("Authorization", "Bearer "+token(t, "active"))
	httpReq.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httpReq)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d，期望 400", rec.Code)
	}
	if inner := errorEnvelope(t, rec); inner["message"] != "docs or images is required" {
		t.Fatalf("message = %v", inner["message"])
	}
}

// 图片走视觉路径：source=image，likely_scanned 恒为 false。
func TestMaterialTextImagePath(t *testing.T) {
	router := NewRouter(depsWithLLM(t, storetest.New(), `{"text":"Alice Chen"}`))
	contentType, body := multipartBody(t, map[string]part{
		"images": {
			fileName:    "page.jpg",
			contentType: "image/jpeg",
			content:     []byte{0xff, 0xd8, 0xff},
		},
	})

	httpReq := httptest.NewRequest(http.MethodPost, "/api/rehearse/material/text", body)
	httpReq.Header.Set("Authorization", "Bearer "+token(t, "active"))
	httpReq.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httpReq)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d，body = %s", rec.Code, rec.Body.String())
	}
	data := envelope(t, rec)
	if data["text"] != "Alice Chen" {
		t.Fatalf("text = %v", data["text"])
	}
	if data["source"] != "image" {
		t.Fatalf("source = %v", data["source"])
	}
	if data["likely_scanned"] != false {
		t.Fatalf("图片路径的 likely_scanned 恒为 false，得到 %v", data["likely_scanned"])
	}
}

func TestMaterialProfileHappyPath(t *testing.T) {
	router := NewRouter(depsWithLLM(t, storetest.New(), `{"profile":"5 年后端"}`))
	rec := send(t, router, request{
		method:        http.MethodPost,
		path:          "/api/rehearse/material/profile",
		authorization: "Bearer " + token(t, "active"),
		contentType:   "application/json",
		body:          `{"kind":"resume","text":"Alice Chen, backend engineer"}`,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d，body = %s", rec.Code, rec.Body.String())
	}
	data := envelope(t, rec)
	if data["profile"] != "5 年后端" || data["kind"] != "resume" {
		t.Fatalf("data = %v", data)
	}
}

// ---------------------------------------------------------------- 管理端

func TestAdminGetAndPartialUpdate(t *testing.T) {
	st := storetest.New()
	router := newTestRouter(t, st)

	// 先把配额设成非默认值，用来验「只改 LLM 字段不会把配额重置」。
	rec := send(t, router, request{
		method:      http.MethodPut,
		path:        "/api/admin/settings/rehearse",
		adminToken:  testAdminToken,
		contentType: "application/json",
		body:        `{"daily_turn_limit":7,"enabled":true}`,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d，body = %s", rec.Code, rec.Body.String())
	}
	if data := envelope(t, rec); data["daily_turn_limit"] != float64(7) {
		t.Fatalf("daily_turn_limit = %v", data["daily_turn_limit"])
	}

	// ⚠️ 这条是本次移植最容易踩的坑：管理端的 LLM 表单会把自己的 body
	// （不含 daily_turn_limit）也 PUT 到这个接口。如果配额是「整体替换」
	// 语义，这一下就会把它重置回默认的 100。
	rec = send(t, router, request{
		method:      http.MethodPut,
		path:        "/api/admin/settings/rehearse",
		adminToken:  testAdminToken,
		contentType: "application/json",
		body:        `{"model":"deepseek-flash"}`,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d，body = %s", rec.Code, rec.Body.String())
	}
	data := envelope(t, rec)
	if data["daily_turn_limit"] != float64(7) {
		t.Fatalf("配额被 LLM 表单重置了：daily_turn_limit = %v，期望仍是 7", data["daily_turn_limit"])
	}
	if data["model"] != "deepseek-flash" {
		t.Fatalf("model = %v", data["model"])
	}

	// GET 回读，形状要扁平（配额与 LLM 同层）。
	rec = send(t, router, request{
		method:     http.MethodGet,
		path:       "/api/admin/settings/rehearse",
		adminToken: testAdminToken,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	data = envelope(t, rec)
	for _, key := range []string{
		"daily_turn_limit", "enabled", "base_url", "model", "temperature",
		"api_key_set", "api_key_masked",
	} {
		if _, ok := data[key]; !ok {
			t.Errorf("管理端响应缺少 %q：%v", key, data)
		}
	}
	// 明文密钥永远不出接口（§13）。
	if strings.Contains(rec.Body.String(), "sk-test") {
		t.Fatalf("响应泄漏了密钥：%s", rec.Body.String())
	}
}

// 管理端 PUT 的配额上限要被 clamp（对齐 Rust 的 clamp_settings）。
func TestAdminUpdateClampsDailyLimit(t *testing.T) {
	router := newTestRouter(t, storetest.New())
	rec := send(t, router, request{
		method:      http.MethodPut,
		path:        "/api/admin/settings/rehearse",
		adminToken:  testAdminToken,
		contentType: "application/json",
		body:        `{"daily_turn_limit":999999}`,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if data := envelope(t, rec); data["daily_turn_limit"] != float64(coach.MaxDailyTurnLimit) {
		t.Fatalf("daily_turn_limit = %v，期望被夹到 %d", data["daily_turn_limit"], coach.MaxDailyTurnLimit)
	}
}

// ---------------------------------------------------------------- CORS

func TestCORSPreflight(t *testing.T) {
	deps := newTestDeps(t, storetest.New())
	deps.Config.AllowedOrigins = []string{"https://rehearse.0x81.uk"}
	router := NewRouter(deps)

	// 白名单内：预检 204 + 允许头。
	rec := send(t, router, request{
		method: http.MethodOptions,
		path:   "/api/rehearse/turn",
		origin: "https://rehearse.0x81.uk",
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("预检 status = %d，期望 204", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://rehearse.0x81.uk" {
		t.Fatalf("Allow-Origin = %q", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(got, "X-Admin-Token") {
		t.Fatalf("Allow-Headers = %q，应当含 X-Admin-Token", got)
	}

	// 白名单外：不发 CORS 头（浏览器据此拦截）。
	rec = send(t, router, request{
		method: http.MethodOptions,
		path:   "/api/rehearse/turn",
		origin: "https://evil.example.com",
	})
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("白名单外的 origin 不该拿到 Allow-Origin，得到 %q", got)
	}
}

// 白名单为空时不发任何 CORS 头——这是正确行为，不是漏配（RN 不带 Origin）。
func TestCORSDisabledWhenNoOriginsConfigured(t *testing.T) {
	router := newTestRouter(t, storetest.New())
	rec := send(t, router, request{
		method:        http.MethodGet,
		path:          "/api/rehearse/quota",
		authorization: "Bearer " + token(t, "active"),
		origin:        "https://rehearse.0x81.uk",
	})
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("未配置白名单时不该发 Allow-Origin，得到 %q", got)
	}
}
