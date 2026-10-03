package llm

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

// 视觉分支：材料图片 → 纯文本（OCR）。只有这一条链路用得到。
//
// 移植自 `moyan-backend/src/services/llm_client.rs` 的 `ImagePart` /
// `build_content_parts` / `chat_json_with_images`（:26-47、:648-656）。

// ImagePart 是一张内存里的图片。
//
// 与公开的请求 DTO 分开是有意的（Rust 的注释也点了这条）：客户端无法把
// 任意 data URL 塞进陪练的 prompt，图片只能从 multipart 上传这一条路进来。
type ImagePart struct {
	MediaType  string
	DataBase64 string
}

// 上传限制，与 Rust 的 `interview_ocr.rs:13-15` 一致。
const (
	MaxImages          = 5
	MaxImageBytes      = 1024 * 1024
	MaxTotalImageBytes = 4 * 1024 * 1024
)

// ValidateImages 校验图片数量、类型与体积。
//
// 返回的是**可下发给客户端的原文**（调用方直接包进 400），所以这里的措辞
// 与 Rust 逐条对齐——App 端可能按文案做本地化。
func ValidateImages(images []ImagePart) error {
	if len(images) == 0 {
		return errors.New("at least one image is required")
	}
	if len(images) > MaxImages {
		return fmt.Errorf("at most %d images", MaxImages)
	}

	total := 0
	for _, image := range images {
		if !strings.HasPrefix(image.MediaType, "image/") {
			return errors.New("media_type must be image/*")
		}
		decoded, err := base64.StdEncoding.DecodeString(image.DataBase64)
		if err != nil {
			return errors.New("image data is not valid base64")
		}
		if len(decoded) > MaxImageBytes {
			return errors.New("each image must be at most 1MB")
		}
		total += len(decoded)
	}
	if total > MaxTotalImageBytes {
		return errors.New("images must total at most 4MB")
	}
	return nil
}

// contentPart 是 OpenAI 多模态消息的一段。
type contentPart struct {
	Type     string        `json:"type"`
	Text     string        `json:"text,omitempty"`
	ImageURL *imageURLPart `json:"image_url,omitempty"`
}

type imageURLPart struct {
	URL string `json:"url"`
	// Detail 固定 high：low 会丢掉小字，简历和 JD 的识别会不可靠
	// （Rust 的注释：`llm_client.rs:33-34`）。
	Detail string `json:"detail"`
}

// buildContentParts 拼出多模态 content 数组：文本在前，图片在后。
//
// 顺序与 Rust 一致（`llm_client.rs:35-47`）——文本在前是 OpenAI 的惯例，
// 也是那条测试 `content_parts_put_text_first_then_images_with_high_detail`
// 断言的形状。
func buildContentParts(text string, images []ImagePart) []contentPart {
	parts := make([]contentPart, 0, len(images)+1)
	parts = append(parts, contentPart{Type: "text", Text: text})
	for _, image := range images {
		parts = append(parts, contentPart{
			Type: "image_url",
			ImageURL: &imageURLPart{
				URL:    fmt.Sprintf("data:%s;base64,%s", image.MediaType, image.DataBase64),
				Detail: "high",
			},
		})
	}
	return parts
}

// ChatJSONWithImages 是 `ChatJSON` 的视觉版。
//
// 调用前必须先过 `ValidateImages`——这里不重复校验，免得两处限制漂移。
func (c *Client) ChatJSONWithImages(
	ctx context.Context,
	settings Settings,
	system, user string,
	images []ImagePart,
	maxTokens int,
) (string, error) {
	return c.chatCompletion(ctx, settings, system, buildContentParts(user, images), maxTokens)
}

// VisionUnsupportedHint 判断上游的错误信息是不是「这个模型不吃图片」。
//
// 用于把上游的 400 翻译成 422 `vision_not_supported`，让 App 能提示用户
// 「改用粘贴文本，或让管理员换一个支持视觉的模型」，而不是笼统的失败。
//
// 规则与 Rust 的 `vision_unsupported_hint`（`interview_ocr.rs:102`）逐字对齐：
// 必须**同时**提到图片语义与拒绝语义。只匹配一半会把「invalid api key」
// 之类的错误误判成「模型不支持视觉」。
func VisionUnsupportedHint(message string) bool {
	lower := strings.ToLower(message)
	mentionsImage := strings.Contains(lower, "image") ||
		strings.Contains(lower, "vision") ||
		strings.Contains(lower, "multimodal")
	mentionsRejection := strings.Contains(lower, "not support") ||
		strings.Contains(lower, "unsupported") ||
		strings.Contains(lower, "invalid") ||
		strings.Contains(lower, "does not")
	return mentionsImage && mentionsRejection
}
