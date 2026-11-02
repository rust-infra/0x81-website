// 本文件是 `GET|PUT /api/rehearse/settings`：用户级设置文档（主题 / 界面语言 /
// 语音偏好），一行一个用户，文档由**客户端全量写**（migrations/*/0002_user_settings）。
//
// 与管理端 `/api/admin/settings/rehearse` 的分工：那边是**运营配置**（配额、
// LLM），一个部署一份；这边是**每个用户自己的偏好**，从 JWT 的 `sub` 隔离。
//
// 服务端对文档的态度是「**存形状、不展开**」：设置项随 App 迭代增减，展开成
// 列意味着每加一个开关都要一次迁移。所以这里只校验少数有语义的枚举与数值
// （theme / language / provider / speed），其余字段原样存取——App 是这份文档
// 唯一的写方与读方。
//
// ⚠️ 密钥类字段（Google / ElevenLabs / 阿里云 / Gemini 的 key、服务账号 JSON）
// **不允许**出现在文档里：它们只存 App 本机（§7.5.1）。这里的校验按「白名单之外
// 的密钥形键一律拒绝」兜底，防止未来某个客户端把密钥顺手塞进来。
package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/0x81/rehearse-backend/internal/middleware"
	"github.com/0x81/rehearse-backend/internal/store"
)

// userSettingsDoc 是设置文档的顶层形状。
//
// `Speech` 保持 RawMessage：语音偏好的字段最多、增减最频繁，服务端只校验其中
// 有语义的几项（见 speechPrefs），不把整个形状复刻一遍。
type userSettingsDoc struct {
	Theme    string          `json:"theme"`
	Language string          `json:"language"`
	Speech   json.RawMessage `json:"speech"`
	// UpdatedAt 只在**响应**里出现：PUT 时由服务端生成（RFC3339 UTC），
	// 客户端拿它做「哪台设备的改动更新」的比较；请求里带了这个字段会被覆盖。
	UpdatedAt string `json:"updated_at,omitempty"`
}

var (
	validThemes       = map[string]bool{"light": true, "dark": true}
	validUILanguages  = map[string]bool{"zh-CN": true, "en": true}
	validTTSProviders = map[string]bool{"webspeech": true, "google": true, "elevenlabs": true, "aliyun": true}
	validSTTProviders = map[string]bool{"system": true, "google-cloud": true, "gemini": true}
	validSpeedRange   = [2]float64{0.1, 2}
	// 这些 JSON 键承载凭据，任何情况下都不入库（§7.5.1）。
	secretSpeechKeys = []string{
		"googleKey", "elevenLabsKey", "aliyunKey",
		"googleCloudServiceAccountJson", "geminiApiKey",
	}
)

// speechPrefs 是语音偏好里**有语义、值得校验**的几项。
type speechPrefs struct {
	Provider    string   `json:"provider"`
	STTProvider string   `json:"sttProvider"`
	Speed       *float64 `json:"speech_speed"`
}

// settingsTimestampLayout 是 RFC3339 UTC + 固定 6 位小数秒。
// 固定宽度让「字符串比较 = 时间比较」严格成立，客户端不解析时间。
const settingsTimestampLayout = "2006-01-02T15:04:05.000000Z"

func validateUserSettings(doc *userSettingsDoc) error {
	if !validThemes[doc.Theme] {
		return middleware.BadRequest("theme must be one of light, dark")
	}
	if !validUILanguages[doc.Language] {
		return middleware.BadRequest("language must be one of zh-CN, en")
	}
	if len(doc.Speech) == 0 {
		return middleware.BadRequest("speech is required")
	}

	var rawKeys map[string]json.RawMessage
	if err := json.Unmarshal(doc.Speech, &rawKeys); err != nil || rawKeys == nil {
		// `speech: null` 也能解出来，但那不是一份文档——拒绝，别让空值顺着往下走。
		return middleware.BadRequest("speech must be a JSON object")
	}
	var prefs speechPrefs
	if err := json.Unmarshal(doc.Speech, &prefs); err != nil {
		return middleware.BadRequest("speech must be a JSON object")
	}
	if prefs.Provider != "" && !validTTSProviders[prefs.Provider] {
		return middleware.BadRequest("speech.provider must be one of webspeech, google, elevenlabs, aliyun")
	}
	if prefs.STTProvider != "" && !validSTTProviders[prefs.STTProvider] {
		return middleware.BadRequest("speech.sttProvider must be one of system, google-cloud, gemini")
	}
	if prefs.Speed != nil && (*prefs.Speed < validSpeedRange[0] || *prefs.Speed > validSpeedRange[1]) {
		return middleware.BadRequest(fmt.Sprintf("speech.speech_speed must be between %g and %g",
			validSpeedRange[0], validSpeedRange[1]))
	}
	for _, key := range secretSpeechKeys {
		if _, ok := rawKeys[key]; ok {
			// 故意不给键名：把「哪个键是密钥」回显给调用方没有意义。
			return middleware.BadRequest("speech must not contain credentials")
		}
	}
	return nil
}

// userSettingsGetHandler 是 `GET /api/rehearse/settings`。
//
// 从未写过的用户拿到**空对象**而不是 404：App 的语义是「没有远端设置就用本机」，
// 让每个调用方把 404 翻译成空文档只会让它们重复这段代码。
func userSettingsGetHandler(st store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, ok := requireClaims(c)
		if !ok {
			return
		}
		raw, err := st.UserSettingsGet(c.Request.Context(), claims.Sub)
		if errors.Is(err, store.ErrUserSettingsNotFound) {
			middleware.OK(c, json.RawMessage("{}"))
			return
		}
		if err != nil {
			middleware.Abort(c, middleware.Internal(err))
			return
		}
		middleware.OK(c, json.RawMessage(raw))
	}
}

// userSettingsPutHandler 是 `PUT /api/rehearse/settings`，全量覆盖。
//
// 局部更新不提供：文档的写方只有 App 自己，它读得到完整现状；
// 在服务端再支持一层 patch 等于把 App 的状态机搬过来一半。
func userSettingsPutHandler(st store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, ok := requireClaims(c)
		if !ok {
			return
		}
		var doc userSettingsDoc
		if err := bindJSON(c, &doc); err != nil {
			middleware.Abort(c, err)
			return
		}
		if err := validateUserSettings(&doc); err != nil {
			middleware.Abort(c, err)
			return
		}

		// 时间戳由服务端生成：两台设备比较「谁新」时，两端拿到的都是
		// 同一台服务器的钟，不受本机时钟偏差影响。
		//
		// 固定 6 位小数不是装饰：客户端用**字符串比较**判断新旧，
		// RFC3339Nano 会裁掉尾零，`.5Z` 和 `.55Z` 的字典序与数值序相反。
		doc.UpdatedAt = time.Now().UTC().Format(settingsTimestampLayout)
		raw, err := json.Marshal(doc)
		if err != nil {
			middleware.Abort(c, middleware.Internal(err))
			return
		}
		if err := st.UserSettingsPut(c.Request.Context(), claims.Sub, string(raw)); err != nil {
			middleware.Abort(c, middleware.Internal(err))
			return
		}
		middleware.OK(c, json.RawMessage(raw))
	}
}
