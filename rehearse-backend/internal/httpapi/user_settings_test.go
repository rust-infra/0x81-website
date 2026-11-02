// `GET|PUT /api/rehearse/settings` 的行为测试（user_settings.go）。
package httpapi

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/0x81/rehearse-backend/internal/store/storetest"
)

const validSettingsBody = `{
	"theme": "dark",
	"language": "en",
	"speech": {
		"provider": "elevenlabs",
		"sttProvider": "gemini",
		"speech_voice": "en-US-Neural2-D",
		"speech_zh_voice": "cmn-CN-Neural2-D",
		"speech_speed": 0.9,
		"auto_play": true,
		"cacheEnabled": true
	}
}`

// tokenFor 与 router_test.go 的 token() 同一把密钥，但允许指定 sub——
// 隔离性测试需要两个不同的用户。
func tokenFor(t *testing.T, sub string) string {
	t.Helper()
	now := time.Now()
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": sub, "email": "a@b.c", "name": "测试", "status": "active",
		"exp": now.Add(time.Hour).Unix(), "iat": now.Unix(),
	}).SignedString(testSecret)
	require.NoError(t, err, "sign")
	return signed
}

func settingsRequest(t *testing.T, method, sub, body string) request {
	req := request{method: method, path: "/api/rehearse/settings", authorization: "Bearer " + tokenFor(t, sub)}
	if body != "" {
		req.body = body
		req.contentType = "application/json"
	}
	return req
}

func TestUserSettingsGetReturnsEmptyObjectForNewUser(t *testing.T) {
	router := newTestRouter(t, storetest.New())
	rec := send(t, router, settingsRequest(t, http.MethodGet, "usr_1", ""))
	require.Equal(t, http.StatusOK, rec.Code, "status（body=%s）", rec.Body.String())
	data := envelope(t, rec)
	require.Empty(t, data, "新用户应当拿到空文档，拿到的是 %v", data)
}

func TestUserSettingsPutThenGetRoundTrip(t *testing.T) {
	fake := storetest.New()
	router := newTestRouter(t, fake)

	rec := send(t, router, settingsRequest(t, http.MethodPut, "usr_1", validSettingsBody))
	require.Equal(t, http.StatusOK, rec.Code, "status（body=%s）", rec.Body.String())
	data := envelope(t, rec)
	assert.Equal(t, "dark", data["theme"], "theme")
	assert.Equal(t, "en", data["language"], "language")
	assert.NotEmpty(t, data["updated_at"], "updated_at 应当由服务端生成")

	// GET 读回的是同一份文档（含 updated_at，客户端靠它比较哪台设备的新）。
	rec = send(t, router, settingsRequest(t, http.MethodGet, "usr_1", ""))
	data = envelope(t, rec)
	assert.Equal(t, "dark", data["theme"], "get: theme")
	assert.Equal(t, "en", data["language"], "get: language")
	assert.NotEmpty(t, data["updated_at"], "get: updated_at")

	speech, ok := data["speech"].(map[string]any)
	require.True(t, ok, "speech 应当是对象：got %T", data["speech"])
	assert.Equal(t, "elevenlabs", speech["provider"], "speech.provider")

	// 存储层拿到的是带 updated_at 的完整文档。
	stored, err := fake.UserSettingsGet(context.Background(), "usr_1")
	require.NoError(t, err, "store: get")
	assert.Contains(t, stored, `"updated_at"`, "store: 文档里应有 updated_at")
}

func TestUserSettingsPutIsFullReplace(t *testing.T) {
	router := newTestRouter(t, storetest.New())

	rec := send(t, router, settingsRequest(t, http.MethodPut, "usr_1", validSettingsBody))
	require.Equal(t, http.StatusOK, rec.Code, "第一次 put")

	// 全量替换的语义下不允许「半个文档」：缺 language/speech 直接 400。
	rec = send(t, router, settingsRequest(t, http.MethodPut, "usr_1", `{"theme":"light"}`))
	require.Equal(t, http.StatusBadRequest, rec.Code, "缺字段的 put 应当 400")

	rec = send(t, router, settingsRequest(t, http.MethodPut, "usr_1", `{"theme":"light","language":"en","speech":{}}`))
	require.Equal(t, http.StatusOK, rec.Code, "完整文档的 put")
	data := envelope(t, rec)
	assert.Equal(t, "light", data["theme"], "theme 应当被整体替换")

	rec = send(t, router, settingsRequest(t, http.MethodGet, "usr_1", ""))
	data = envelope(t, rec)
	assert.Equal(t, "light", data["theme"], "get: theme")
	assert.NotContains(t, rec.Body.String(), "elevenlabs", "旧文档的字段不应残留")
}

func TestUserSettingsValidation(t *testing.T) {
	router := newTestRouter(t, storetest.New())
	cases := []struct {
		name    string
		body    string
		message string
	}{
		{"非法 theme", `{"theme":"ink","language":"en","speech":{}}`, "theme must be one of light, dark"},
		{"非法 language", `{"theme":"dark","language":"fr","speech":{}}`, "language must be one of zh-CN, en"},
		{"缺 speech", `{"theme":"dark","language":"en"}`, "speech is required"},
		{"speech 为 null", `{"theme":"dark","language":"en","speech":null}`, "speech must be a JSON object"},
		{"非法 TTS provider", `{"theme":"dark","language":"en","speech":{"provider":"polly"}}`, "speech.provider must be one of webspeech, google, elevenlabs, aliyun"},
		{"非法 STT provider", `{"theme":"dark","language":"en","speech":{"sttProvider":"whisper"}}`, "speech.sttProvider must be one of system, google-cloud, gemini"},
		{"语速越界", `{"theme":"dark","language":"en","speech":{"speech_speed":9}}`, "speech.speech_speed must be between 0.1 and 2"},
		{"密钥形键", `{"theme":"dark","language":"en","speech":{"elevenLabsKey":"sk-1"}}`, "speech must not contain credentials"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := send(t, router, settingsRequest(t, http.MethodPut, "usr_1", tc.body))
			require.Equal(t, http.StatusBadRequest, rec.Code, "status（body=%s）", rec.Body.String())
			assert.Equal(t, tc.message, errorEnvelope(t, rec)["message"], "message")
		})
	}
}

// 两个用户的文档互不可见：隔离键是 JWT 的 sub，不是「全局一份」。
func TestUserSettingsAreIsolatedPerUser(t *testing.T) {
	router := newTestRouter(t, storetest.New())

	rec := send(t, router, settingsRequest(t, http.MethodPut, "usr_1", validSettingsBody))
	require.Equal(t, http.StatusOK, rec.Code, "usr_1 put")

	rec = send(t, router, settingsRequest(t, http.MethodGet, "usr_2", ""))
	require.Equal(t, http.StatusOK, rec.Code, "usr_2 get")
	assert.Empty(t, envelope(t, rec), "usr_2 不应当看到 usr_1 的设置")
}
