package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/0x81/rehearse-backend/internal/coach"
	"github.com/0x81/rehearse-backend/internal/config"
	"github.com/0x81/rehearse-backend/internal/llm"
	"github.com/0x81/rehearse-backend/internal/material"
	"github.com/0x81/rehearse-backend/internal/scenarios"
	"github.com/0x81/rehearse-backend/internal/store"
	"github.com/0x81/rehearse-backend/internal/store/storetest"
)

// newTestRouter 装配一个真实的路由（含真实场景目录）。
//
// 用真实目录而不是 stub：路由层要验的恰恰是「场景数据能不能正确下发」，
// stub 掉就把待验的东西换成了假设。
//
// LLM 指向一个本地 httptest 服务（`testLLM`），所以需要走模型的用例也能跑通。
func newTestRouter(t *testing.T, st store.Store) http.Handler {
	t.Helper()
	return NewRouter(newTestDeps(t, st))
}

// testLLM 是一个永远返回固定内容的 OpenAI 兼容端点。
//
// 路由层的用例不该依赖某个具体模型的行为，只需要一个「能返回 JSON」的上游。
func testLLM(t *testing.T) *llm.Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"reply\":\"ok\",\"mood\":\"neutral\"}"}}]}`))
	}))
	t.Cleanup(server.Close)

	client := llm.New()
	// 让所有用例共用同一个上游：把地址塞进 fallback 而不是每个用例各起一个。
	testLLMBaseURL = server.URL
	return client
}

// testLLMBaseURL 由 testLLM 写入，newTestDeps 读取。
var testLLMBaseURL string

func newTestDeps(t *testing.T, st store.Store) Deps {
	t.Helper()
	catalog, err := scenarios.Load()
	if err != nil {
		t.Fatalf("load scenario catalog: %v", err)
	}
	client := testLLM(t)
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

var testSecret = []byte("test-secret-ascii-only")

// newStore 造一个内存 store，让路由测试不依赖真实 Postgres。
func newStore() *storetest.Fake { return storetest.New() }

// newDegradedStore 造一个「库连不上」的 store，用于验 /health 的降级分支。
func newDegradedStore() *storetest.Fake {
	st := storetest.New()
	st.PingErr = errors.New("connection refused")
	return st
}

func testConfig() *config.Config {
	return &config.Config{
		Port:       config.DefaultPort,
		JWTSecret:  testSecret,
		AdminToken: testAdminToken,
		// 白名单留空：默认不发 CORS 头（见 middleware/cors.go 的说明）。
		AllowedOrigins: nil,
	}
}

// testAdminToken 是测试里的管理端凭证。
const testAdminToken = "admin-token-for-tests"

func token(t *testing.T, status string) string {
	t.Helper()
	now := time.Now()
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "usr_abc", "email": "a@b.c", "name": "测试", "status": status,
		"exp": now.Add(time.Hour).Unix(), "iat": now.Unix(),
	}).SignedString(testSecret)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return signed
}

func do(t *testing.T, handler http.Handler, method, path, authorization string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

// 健康检查必须**不带 token 也能过**——编排层的 healthcheck 不会带凭证。
// 这条如果挂了，容器会永远处于 unhealthy。
func TestHealth_DoesNotRequireAuth(t *testing.T) {
	router := newTestRouter(t, newStore())
	status, body := do(t, router, http.MethodGet, "/health", "")
	if status != http.StatusOK {
		t.Fatalf("status = %d, body = %s", status, body)
	}
	if !strings.Contains(body, `"status":"ok"`) || !strings.Contains(body, `"database":"ok"`) {
		t.Fatalf("body = %s", body)
	}
}

// DB 不可用时必须明确报错。§7.3 换成独立托管 PG 之后它是唯一外部依赖，
// 如果 /health 只回 200，编排层会以为一切正常。
func TestHealth_ReportsDatabaseFailure(t *testing.T) {
	router := newTestRouter(t, newDegradedStore())
	status, body := do(t, router, http.MethodGet, "/health", "")
	if status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body = %s", status, body)
	}
	if !strings.Contains(body, `"database":"unreachable"`) {
		t.Fatalf("body = %s", body)
	}
	// 底层错误（可能含连接串）不能下发。
	if strings.Contains(body, "connection refused") {
		t.Fatalf("泄漏了底层错误: %s", body)
	}
}

// 认证要**挂在整棵 /api/rehearse/ 子树上**，漏挂一个路由就是一个未鉴权端点。
// 这条测保证新加路由时不会忘。
func TestAPISubtree_RequiresAuth(t *testing.T) {
	router := newTestRouter(t, newStore())
	for _, path := range []string{
		"/api/rehearse/whoami",
		"/api/rehearse/anything-not-implemented-yet",
	} {
		status, body := do(t, router, http.MethodGet, path, "")
		if status != http.StatusUnauthorized {
			t.Errorf("%s 未带 token 应回 401，实际 %d: %s", path, status, body)
		}
	}
}

func TestWhoami_ReturnsClaims(t *testing.T) {
	router := newTestRouter(t, newStore())
	status, body := do(t, router, http.MethodGet, "/api/rehearse/whoami", "Bearer "+token(t, "active"))
	if status != http.StatusOK {
		t.Fatalf("status = %d, body = %s", status, body)
	}
	for _, want := range []string{`"success":true`, `"sub":"usr_abc"`, `"status":"active"`} {
		if !strings.Contains(body, want) {
			t.Errorf("响应缺少 %s: %s", want, body)
		}
	}
}

// status 检查要在**路由层**也生效（不只中间件单测）。
func TestWhoami_RejectsInactiveUser(t *testing.T) {
	router := newTestRouter(t, newStore())
	status, body := do(t, router, http.MethodGet, "/api/rehearse/whoami", "Bearer "+token(t, "disabled"))
	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", status, body)
	}
}

// 未知路由不该意外套上鉴权信封（会让人以为「这个路径存在但没权限」）。
func TestUnknownRoute_IsPlain404(t *testing.T) {
	router := newTestRouter(t, newStore())
	status, body := do(t, router, http.MethodGet, "/nope", "")
	if status != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", status, body)
	}
	if strings.Contains(body, `"success"`) {
		t.Fatalf("404 不该带业务信封: %s", body)
	}
}

func TestScenarios_RequiresAuth(t *testing.T) {
	router := newTestRouter(t, newStore())
	status, _ := do(t, router, http.MethodGet, "/api/rehearse/scenarios", "")
	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d, 期望 401", status)
	}
}

// 响应形状要与 moyan-backend 一致：`{success:true, data:[...]}`——
// `data` 是**裸数组**，不是包了一层的对象（`controllers/coach.rs:20`）。
func TestScenarios_ShapeAndDefaults(t *testing.T) {
	router := newTestRouter(t, newStore())
	status, body := do(t, router, http.MethodGet, "/api/rehearse/scenarios", "Bearer "+token(t, "active"))
	if status != http.StatusOK {
		t.Fatalf("status = %d, body = %s", status, body)
	}

	var got struct {
		Success bool             `json:"success"`
		Data    []map[string]any `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatalf("响应不是预期形状: %v\nbody=%.400s", err, body)
	}
	if !got.Success {
		t.Error("success 应为 true")
	}
	// 不带参数时默认 zh-CN，所以应当是中文标题。
	if len(got.Data) != 14 {
		t.Fatalf("场景数 = %d, 期望 14", len(got.Data))
	}
	first := got.Data[0]
	if first["source"] != "preset" {
		t.Errorf("source = %v, 期望 preset", first["source"])
	}
	// 顺序由 §5.1 的族顺序决定，所以第 0 个是 interview 族的第一个。
	if first["id"] != "interview_screening" {
		t.Errorf("第 0 个场景 = %v, 期望 interview_screening（§5.1 族顺序）", first["id"])
	}
	title, _ := first["title"].(string)
	if !hasCJK(title) {
		t.Errorf("默认语言下标题应是中文，实际 %q", title)
	}
	// 族字段必须是新枚举，不能是旧的 engineering / high_stakes。
	for _, item := range got.Data {
		switch item["category"] {
		case "interview", "pitch", "hard_talk", "daily":
		default:
			t.Errorf("%v 的 category = %v，不是 §5.1 的新枚举", item["id"], item["category"])
		}
	}
}

func hasCJK(value string) bool {
	for _, r := range value {
		if r >= 0x4E00 && r <= 0x9FFF {
			return true
		}
	}
	return false
}

func TestScenarios_LanguageSwitchesTitles(t *testing.T) {
	router := newTestRouter(t, newStore())
	auth := "Bearer " + token(t, "active")

	_, zhBody := do(t, router, http.MethodGet, "/api/rehearse/scenarios?language=zh-CN", auth)
	_, enBody := do(t, router, http.MethodGet, "/api/rehearse/scenarios?language=en-US", auth)

	var zh, en struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal([]byte(zhBody), &zh); err != nil {
		t.Fatalf("zh 响应解析失败: %v", err)
	}
	if err := json.Unmarshal([]byte(enBody), &en); err != nil {
		t.Fatalf("en 响应解析失败: %v", err)
	}
	if zh.Data[0]["title"] == en.Data[0]["title"] {
		t.Errorf("中英标题相同（%v），language 参数没生效", zh.Data[0]["title"])
	}
}

// 非法的 language 要明确报错，而不是静默按英文处理——
// 客户端一个拼写错误会表现成「场景全是英文」，比 400 难查。
func TestScenarios_RejectsUnknownLanguage(t *testing.T) {
	router := newTestRouter(t, newStore())
	status, body := do(t, router, http.MethodGet,
		"/api/rehearse/scenarios?language=klingon", "Bearer "+token(t, "active"))
	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, 期望 400; body = %s", status, body)
	}
	if !strings.Contains(body, `"code":400`) {
		t.Errorf("错误信封形状不对: %s", body)
	}
}

// ⚠️ 线上契约层面的泄漏检查：把真实响应体全文搜一遍，确认服务端指导语
// 没有出现在任何地方（§4.4）。
//
// 与 `scenarios` 包里的结构测试互补——那条保证 DTO 类型里没有 guidance，
// 这条保证**实际发出去的字节**里也没有。将来若有人把 guidance 塞进
// 某个 map 或加了新字段，只有这条能抓到。
func TestScenarios_NeverLeaksGuidanceOverTheWire(t *testing.T) {
	catalog, err := scenarios.Load()
	if err != nil {
		t.Fatalf("load catalog: %v", err)
	}
	router := newTestRouter(t, newStore())
	auth := "Bearer " + token(t, "active")

	for _, language := range []string{"zh-CN", "en-US"} {
		_, body := do(t, router, http.MethodGet,
			"/api/rehearse/scenarios?language="+language, auth)
		if strings.Contains(body, "guidance") {
			t.Fatalf("响应里出现了 guidance 键名（language=%s）", language)
		}
		for _, id := range catalog.IDs() {
			guidance, _ := catalog.Guidance(id)
			if needle := firstRunes(guidance, 12); strings.Contains(body, needle) {
				t.Fatalf("%s 的 guidance 正文泄漏进了响应（language=%s）", id, language)
			}
		}
	}
}

func firstRunes(value string, n int) string {
	runes := []rune(value)
	if len(runes) <= n {
		return value
	}
	return string(runes[:n])
}
