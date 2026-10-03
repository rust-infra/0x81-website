package material

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/0x81/rehearse-backend/internal/llm"
	"github.com/0x81/rehearse-backend/internal/middleware"
)

// 本文件是 `/material/text` 的图片分支：图片 → 纯文本（OCR）。
//
// 移植自 `moyan-backend/src/services/interview_ocr.rs`（198 行）。
// 只做逐字识别：不总结、不改写、不补充——结构化是下一步，中间隔着用户编辑。
// 图片只在内存中处理，不落盘、不写日志。

// maxOCRTokens 是单次 OCR 的输出 token 上限（interview_ocr.rs:16）。
const maxOCRTokens = 4_000

// ocrSystemPrompt 与 Rust 的 OCR_SYSTEM_PROMPT 逐字一致（interview_ocr.rs:18-22）。
//
// 用反引号原样字符串是为了保住 `{"text":"..."}` 后的那个真实换行——Rust 里
// 它是 `\n` 转义。prompt 的措辞是契约的一部分，不做任何润色。
const ocrSystemPrompt = `You transcribe documents verbatim. Return JSON only: {"text":"..."}
Transcribe every visible character exactly as it appears, including headings, dates, numbers and contact details. Do NOT summarise, translate, rewrite, reorder or fill in gaps. Preserve line breaks between logical blocks. If a region is unreadable, write [unclear] in place.`

// msgOCRUnavailable 是 OCR 上游失败时的固定文案。
//
// ⚠️ 这是一处**有意的偏离**（Rust 不同）：Rust 把上游的响应体原样当成 400
// 返回（interview_ocr.rs:64 的 `Err(e) => Err(e)`），而上游错误体里可能有
// 账号标识、配额信息。本项目的规则是**上游错误体永不下发**（§13），
// 所以这里统一压成一句固定文案的 503。
const msgOCRUnavailable = "AI material parsing is temporarily unavailable"

// msgVisionNotSupported 是 422 vision_not_supported 的固定文案
// （interview_ocr.rs:57-62，Rust 用 `\` 续行拼接，实际就是这一行）。
const msgVisionNotSupported = "The configured model does not accept image input. " +
	"Use pasted text, or ask the admin to switch to a vision-capable model such as deepseek-flash."

// OCRService 把材料图片转成文本。
type OCRService struct {
	quota    QuotaConsumer
	settings LLMSettingsResolver
	client   *llm.Client
}

// NewOCRService 组装 OCR 服务。
func NewOCRService(quota QuotaConsumer, settings LLMSettingsResolver, client *llm.Client) *OCRService {
	return &OCRService{quota: quota, settings: settings, client: client}
}

// OCR 识别一组图片，返回逐字转写的文本。
//
// ⚠️ 调用顺序是护栏的一部分，不要重排（对齐 interview_ocr.rs:39-42 与
// coach/turn.go 的同一段顺序）：
//
//  1. 图片校验——在**任何外部调用之前**，非法图片不产生 LLM 请求也不扣额度
//  2. 解析配置
//  3. `settings.Configured()` 检查——**必须在扣额度之前**。服务没配好时先返回
//     503，否则用户会白掉一次额度却拿不到任何结果（`llm.ErrNotConfigured` 的
//     注释也点了这条）
//  4. 扣额度——超限直接 429，同样不产生 LLM 请求
//  5. 调视觉模型
func (s *OCRService) OCR(ctx context.Context, userID string, images []llm.ImagePart) (string, error) {
	// 图片的数量 / 类型 / base64 / 体积限制全部委托给 llm.ValidateImages，
	// 不在这里重写一遍——两处各写一份必然漂移（interview_ocr.rs:69-100
	// 与 llm_client 里的限制是同一个来源）。
	if err := llm.ValidateImages(images); err != nil {
		return "", middleware.BadRequest(err.Error())
	}

	settings, err := s.settings.Resolve(ctx)
	if err != nil {
		return "", middleware.Repository(err)
	}
	if !settings.Configured() {
		return "", middleware.ServiceUnavailable(msgAINotConfigured)
	}

	if err := s.quota.CheckAndConsume(ctx, userID); err != nil {
		return "", err
	}

	raw, err := s.client.ChatJSONWithImages(
		ctx, settings, ocrSystemPrompt, "Transcribe the attached document images.",
		images, maxOCRTokens,
	)
	if err != nil {
		return "", mapOCRUpstreamError(err)
	}
	return parseOCRPayload(raw)
}

// mapOCRUpstreamError 把上游失败翻译成客户端可见的错误。
//
// 只有「模型明确拒绝图片输入」这一种上游失败可以给客户端更精确的 422；
// 其余一律 503 固定文案（见 msgOCRUnavailable 的说明）。
//
// 判别串按 Rust 的方式从「状态码 + 响应体」拼出来（interview_ocr.rs:55 的
// `AppError::BadRequest(message)`），因为 VisionUnsupportedHint 要**同时**
// 看到图片语义（image / vision / multimodal）和拒绝语义（not support /
// unsupported / invalid / does not）才成立。
func mapOCRUpstreamError(err error) error {
	var upstream *llm.ErrUpstream
	if errors.As(err, &upstream) {
		message := fmt.Sprintf("LLM error (%d): %s", upstream.StatusCode, upstream.Detail)
		if llm.VisionUnsupportedHint(message) {
			return middleware.Unprocessable("vision_not_supported", msgVisionNotSupported)
		}
	}
	return middleware.ServiceUnavailable(msgOCRUnavailable)
}

// llmOCRPayload 是模型输出的形状：`{"text":"..."}`。
type llmOCRPayload struct {
	Text string `json:"text"`
}

// parseOCRPayload 解析 OCR 的 JSON 输出。
//
// 移植自 interview_ocr.rs:117-126：先去围栏，再解 JSON；文本 trim 后为空
// 视为失败。两条都是 400——它们意味着模型没按约定返回，客户端改不了，
// 但也不该被当成服务故障。
func parseOCRPayload(raw string) (string, error) {
	var payload llmOCRPayload
	if err := json.Unmarshal([]byte(stripCodeFences(raw)), &payload); err != nil {
		return "", middleware.BadRequest("invalid OCR JSON: " + err.Error())
	}
	text := strings.TrimSpace(payload.Text)
	if text == "" {
		return "", middleware.BadRequest("OCR returned no text")
	}
	return text, nil
}
