// Package material 是面试材料链路：文档 / 图片 → 文本 → 紧凑档案。
//
// 三个文件分别移植 moyan-backend 的三个 Rust 服务（§7.9 的对照表）：
//
//	text.go    ← services/interview_docs.rs（166 行）
//	vision.go  ← services/interview_ocr.rs（198 行）
//	profile.go ← services/interview_profile.rs（152 行）
//
// 隐私：材料只在内存中处理，不落盘、不写日志；错误信息只含错误类型，
// 不含材料内容（§10、§13 的「材料样本身份串不进日志」）。
package material

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"strings"
	"unicode/utf8"

	"github.com/ledongthuc/pdf"

	"github.com/0x81/rehearse-backend/internal/llm"
	"github.com/0x81/rehearse-backend/internal/middleware"
)

// QuotaConsumer / LLMSettingsResolver 是 material 依赖的两个外部能力的**小接口**。
//
// 刻意不直接依赖 internal/coach 的 *QuotaService / *LLMSettingsService：material
// 每个只用到其中一个方法，反向依赖 coach 会把「材料链路」和「演练编排」焊在
// 一起，也让 material 的测试不得不拉起 coach 的整张依赖图。生产装配处把
// *coach.QuotaService / *coach.LLMSettingsService 直接传进来即可（它们满足接口）。
type QuotaConsumer interface {
	CheckAndConsume(ctx context.Context, userID string) error
}

// LLMSettingsResolver 解析当前生效的 LLM 配置（DB 优先、env 兜底）。
type LLMSettingsResolver interface {
	Resolve(ctx context.Context) (llm.Settings, error)
}

// ScannedTextThreshold 低于这个**字符数**就认为多半是扫描件，App 会提示改用
// 图片上传。与 Rust 的 SCANNED_TEXT_THRESHOLD 一致（interview_docs.rs:13）。
const ScannedTextThreshold = 200

// MaxUploadBytes 是上传体积上限，10 MiB（interview_docs.rs:15）。
//
// 同时用于两个地方：上传体本身，以及 DOCX 解压后的 document.xml——
// 后者是 zip 炸弹的护栏，见 parseDocx。
const MaxUploadBytes = 10 * 1024 * 1024

// msgAINotConfigured 是「LLM 没配」时下发的固定文案。
//
// 与 internal/coach 的 MsgAINotConfigured 逐字相同（Rust 的
// `ensure_configured` 失败文案）——客户端可能按文案做本地化，不能两边不一样。
// material 不复用 coach 的那个常量，因为为了一行字符串 import coach 会把
// 两条链路耦在一起（见上面的接口注释）；两边字面量各自由测试钉住。
const msgAINotConfigured = "AI service is not configured"

// ParsedDocument 是文档抽取的结果（interview_docs.rs:17-22 的 ParsedDocument）。
type ParsedDocument struct {
	Text      string
	CharCount int
	// LikelyScanned 在字符数低于 ScannedTextThreshold 时为 true。
	LikelyScanned bool
}

// IsLikelyScanned 判断文本是不是「多半来自扫描件」。
//
// ⚠️ 按**字符数**（rune）而不是字节数：一个 200 字的简历只有 ~600 字节，
// 用 len() 会把它判成「不短」，扫描件提示就永远不触发（interview_docs.rs:24）。
func IsLikelyScanned(text string) bool {
	return countRunes(text) < ScannedTextThreshold
}

// DocxXMLToText 去标签、解实体、按段分行——DOCX 正文在 word/document.xml 里。
//
// 移植自 interview_docs.rs:29-59。三步的顺序不能换：
//
//  1. 先把 `</w:p>` / `<w:br/>` 换成换行、`<w:tab/>` 换成制表符——这三者要在
//     去标签**之前**处理，否则它们会连着尖括号一起被吃掉，段落全糊成一行。
//  2. 再去掉所有 `<...>` 标签（在标签内的字符一律丢弃）。
//  3. 最后解实体。**必须放在去标签之后**：正文里转义过的 `&lt;w:t&gt;`
//     要保留成字面 `<w:t>`，如果先解实体就会被误当成标签删掉。
func DocxXMLToText(xml string) string {
	withBreaks := strings.ReplaceAll(xml, "</w:p>", "\n")
	withBreaks = strings.ReplaceAll(withBreaks, "<w:br/>", "\n")
	withBreaks = strings.ReplaceAll(withBreaks, "<w:tab/>", "\t")

	var builder strings.Builder
	inTag := false
	for _, r := range withBreaks {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
		case !inTag:
			builder.WriteRune(r)
		}
	}

	// 逐条 ReplaceAll、且顺序与 Rust 完全一致（&amp; 在最前）。用
	// strings.NewReplacer 单趟替换看起来等价，但它**不做二次解码**：
	// `&amp;lt;` 在 Rust 里会先变 `&lt;` 再变 `<`，单趟替换只会得到 `&lt;`。
	// 保留这个顺序是为了和 Rust 逐字节对齐，不是随手写的。
	decoded := strings.ReplaceAll(builder.String(), "&amp;", "&")
	decoded = strings.ReplaceAll(decoded, "&lt;", "<")
	decoded = strings.ReplaceAll(decoded, "&gt;", ">")
	decoded = strings.ReplaceAll(decoded, "&quot;", "\"")
	decoded = strings.ReplaceAll(decoded, "&apos;", "'")

	return normalizeLines(decoded)
}

// ParseDocument 按文件名后缀抽取 PDF / DOCX 的纯文本。
//
// 移植自 interview_docs.rs:93-118。只认 .pdf 与 .docx（后缀大小写不敏感），
// 其余一律 400 并提示改用粘贴或拍照。
func ParseDocument(fileName string, data []byte) (ParsedDocument, error) {
	if len(data) == 0 {
		return ParsedDocument{}, middleware.BadRequest("uploaded file is empty")
	}
	if len(data) > MaxUploadBytes {
		return ParsedDocument{}, middleware.BadRequest("uploaded file is too large")
	}

	lower := strings.ToLower(fileName)
	var (
		text string
		err  error
	)
	switch {
	case strings.HasSuffix(lower, ".pdf"):
		text, err = parsePDF(data)
	case strings.HasSuffix(lower, ".docx"):
		text, err = parseDocx(data)
	default:
		return ParsedDocument{}, middleware.BadRequest(
			"only .pdf and .docx are supported; use paste or photos otherwise")
	}
	if err != nil {
		return ParsedDocument{}, err
	}

	return ParsedDocument{
		Text:          text,
		CharCount:     countRunes(text),
		LikelyScanned: IsLikelyScanned(text),
	}, nil
}

// parseDocx 从 zip 里取 word/document.xml 并转成文本。
//
// 移植自 interview_docs.rs:61-79。**zip 炸弹护栏**：压缩率极高的 docx 解压后
// 可以撑爆内存，所以用 LimitReader 最多只读 MaxUploadBytes+1 字节，
// 再多就说明解压后越界（Rust 用 `entry.take(MAX_UPLOAD_BYTES + 1)`）。
// 读到的字节数超过上限即拒绝，绝不把整段解压内容读进内存。
func parseDocx(data []byte) (string, error) {
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", middleware.BadRequest("invalid docx archive")
	}

	var entry *zip.File
	for _, candidate := range archive.File {
		if candidate.Name == "word/document.xml" {
			entry = candidate
			break
		}
	}
	if entry == nil {
		return "", middleware.BadRequest("docx is missing word/document.xml")
	}

	reader, err := entry.Open()
	if err != nil {
		return "", middleware.BadRequest("invalid docx archive")
	}
	defer reader.Close()

	raw, err := io.ReadAll(io.LimitReader(reader, int64(MaxUploadBytes)+1))
	if err != nil {
		// 解压 / 读取失败在 Rust 里同样映射成「不是合法 UTF-8」（read_to_string 的
		// 错误被统一吞掉，interview_docs.rs:72）。
		return "", middleware.BadRequest("docx document.xml is not valid UTF-8")
	}
	// 先验 UTF-8、再验长度：Rust 的 read_to_string 在遇到非法字节时**先**失败，
	// 所以一份又超限又非法 UTF-8 的文档报的是 UTF-8 错误。顺序反了会换一条文案。
	if !utf8.Valid(raw) {
		return "", middleware.BadRequest("docx document.xml is not valid UTF-8")
	}
	if len(raw) > MaxUploadBytes {
		return "", middleware.BadRequest("docx document.xml expands beyond the upload limit")
	}
	return DocxXMLToText(string(raw)), nil
}

// parsePDF 用纯 Go 的 ledongthuc/pdf 抽取文本。
//
// 移植自 interview_docs.rs:81-91。选这个库是因为它**不用 cgo**——运行镜像是
// scratch，CGO 静态链接会多出 libc 依赖（§7.1 的两个坑之一）。
//
// ⚠️ 与 Rust 的一处**有意差异**：这个纯 Go 库在畸形 PDF 上会 panic
// （已知有切片越界），而输入是用户可控的字节。Rust 的 pdf_extract 只会返回
// Err，所以这里补一个 recover，把 panic 收敛成与抽取失败相同的 400，
// 而不是让一次上传把请求 goroutine 打崩。
func parsePDF(data []byte) (text string, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			text = ""
			err = middleware.BadRequest("pdf text extraction failed")
		}
	}()

	reader, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", middleware.BadRequest("pdf text extraction failed")
	}
	plain, err := reader.GetPlainText()
	if err != nil {
		return "", middleware.BadRequest("pdf text extraction failed")
	}
	raw, err := io.ReadAll(plain)
	if err != nil {
		return "", middleware.BadRequest("pdf text extraction failed")
	}
	return normalizeLines(string(raw)), nil
}

// normalizeLines 逐行 trim、丢掉空行、再用 \n 连接。
//
// 与 Rust 的 `.lines().map(str::trim).filter(!empty).join("\n")` 等价
// （interview_docs.rs:53-58、:84-89）。用 strings.Split 而非 strings.Lines：
// 后者会保留行尾的 \r，而这里的 TrimSpace 正好把 \r 当空白去掉，
// 两种写法的结果一致，Split 还少一层迭代器。
func normalizeLines(text string) string {
	lines := strings.Split(text, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
	}
	return strings.Join(out, "\n")
}

// countRunes 是「按字符数」的统一口径。
//
// coach 包里有一个同名的未导出函数，但跨包用不了；为一条 `len([]rune(s))`
// 去反向依赖 coach 不值得，所以在 material 里各留一份小的。
func countRunes(value string) int { return len([]rune(value)) }

// stripCodeFences 去掉模型偶尔包上的 ```json ... ``` 围栏。
//
// 与 coach.StripCodeFences 同实现，但**不 import coach**（理由见接口注释）。
// 明明 prompt 里要求了 JSON only，模型仍会时不时加围栏，解析前必须容错。
func stripCodeFences(raw string) string {
	trimmed := strings.TrimSpace(raw)
	withoutOpen := trimmed
	if rest, ok := strings.CutPrefix(withoutOpen, "```json"); ok {
		withoutOpen = rest
	} else if rest, ok := strings.CutPrefix(withoutOpen, "```"); ok {
		withoutOpen = rest
	}
	withoutClose, _ := strings.CutSuffix(withoutOpen, "```")
	return strings.TrimSpace(withoutClose)
}
