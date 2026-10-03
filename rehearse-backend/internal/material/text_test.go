package material

import (
	"archive/zip"
	"bytes"
	"fmt"
	"strings"
	"testing"
)

// 本文件对齐 `interview_docs.rs` 的 #[cfg(test)] 块，并补上 Rust 没写但
// 会在线上咬人的边界：空上传、超限上传、缺 document.xml、坏 zip、
// 非法 UTF-8、以及 PDF 的成败两条路径。

// 对齐 Rust 的 `docx_xml_to_text_keeps_paragraph_breaks`（interview_docs.rs:124）。
func TestDocxXMLToTextKeepsParagraphBreaks(t *testing.T) {
	xml := "<w:body><w:p><w:r><w:t>Alice Chen</w:t></w:r></w:p>" +
		"<w:p><w:r><w:t>Backend Engineer</w:t></w:r></w:p></w:body>"
	if got := DocxXMLToText(xml); got != "Alice Chen\nBackend Engineer" {
		t.Fatalf("DocxXMLToText = %q，期望两段各一行", got)
	}
}

// 对齐 Rust 的 `docx_xml_decodes_entities`（interview_docs.rs:131）。
func TestDocxXMLToTextDecodesEntities(t *testing.T) {
	if got := DocxXMLToText("<w:t>A &amp; B &lt;C&gt;</w:t>"); got != "A & B <C>" {
		t.Fatalf("实体解码 = %q，期望 %q", got, "A & B <C>")
	}
}

// <w:br/> 与 <w:tab/> 要在去标签之前换成换行 / 制表符，否则整段会糊成一行。
func TestDocxXMLToTextHandlesBreaksAndTabs(t *testing.T) {
	got := DocxXMLToText("<w:p><w:r><w:t>line1</w:t><w:br/><w:t>line2</w:t></w:r></w:p>")
	if got != "line1\nline2" {
		t.Fatalf("<w:br/> 处理 = %q，期望 %q", got, "line1\nline2")
	}

	// 行内 tab 会保留，但行首行尾的会被逐行 trim 掉（Rust 同样如此）。
	got = DocxXMLToText("<w:t>a<w:tab/>b</w:t>")
	if got != "a\tb" {
		t.Fatalf("<w:tab/> 处理 = %q，期望 %q", got, "a\tb")
	}
}

// 转义过的标签必须保留成字面文本——这钉住「先去掉真标签、再解实体」的顺序。
func TestDocxXMLToTextPreservesEscapedTags(t *testing.T) {
	if got := DocxXMLToText("<w:t>&lt;w:p&gt;</w:t>"); got != "<w:p>" {
		t.Fatalf("转义标签 = %q，期望 %q", got, "<w:p>")
	}
}

// 对齐 Rust 的 `short_text_is_flagged_as_likely_scanned`（interview_docs.rs:140），
// 并补上阈值两侧——Rust 只测了 threshold+1，没测正好等于阈值的情况。
func TestIsLikelyScannedThreshold(t *testing.T) {
	cases := []struct {
		name string
		text string
		want bool
	}{
		{"短文本", "page 1", true},
		{"差一个字符", strings.Repeat("字", ScannedTextThreshold-1), true},
		{"正好到阈值", strings.Repeat("字", ScannedTextThreshold), false},
		{"超过阈值", strings.Repeat("字", ScannedTextThreshold+1), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsLikelyScanned(tc.text); got != tc.want {
				t.Fatalf("IsLikelyScanned(%d 字) = %v，期望 %v", countRunes(tc.text), got, tc.want)
			}
		})
	}
}

// 字符数按 rune 算：3 个汉字是 3 个字符而不是 9 个字节。
func TestParseDocumentCharCountIsRunes(t *testing.T) {
	docx := buildDocx(t, "word/document.xml", []byte("<w:p><w:t>你好世界</w:t></w:p>"))
	doc, err := ParseDocument("resume.docx", docx)
	if err != nil {
		t.Fatalf("不该报错：%v", err)
	}
	if doc.CharCount != 4 {
		t.Fatalf("CharCount = %d，期望 4（按 rune）", doc.CharCount)
	}
}

func TestParseDocumentRejectsEmptyUpload(t *testing.T) {
	_, err := ParseDocument("resume.pdf", nil)
	if err == nil || !strings.Contains(err.Error(), "uploaded file is empty") {
		t.Fatalf("空上传错误 = %v，期望 uploaded file is empty", err)
	}
}

func TestParseDocumentRejectsOversizeUpload(t *testing.T) {
	oversize := make([]byte, MaxUploadBytes+1)
	_, err := ParseDocument("resume.pdf", oversize)
	if err == nil || !strings.Contains(err.Error(), "uploaded file is too large") {
		t.Fatalf("超限上传错误 = %v，期望 uploaded file is too large", err)
	}
}

// 对齐 Rust 的 `rejects_unknown_extension`（interview_docs.rs:163）。
func TestParseDocumentRejectsUnknownExtension(t *testing.T) {
	_, err := ParseDocument("resume.txt", []byte("hello"))
	if err == nil || !strings.Contains(err.Error(), "only .pdf and .docx are supported") {
		t.Fatalf("未知后缀错误 = %v", err)
	}
}

// 对齐 Rust 的 `rejects_docx_xml_that_expands_past_limit`（interview_docs.rs:146）。
// 压缩率极高的 docx 解压后能撑爆内存，护栏必须在读完之前生效。
func TestParseDocumentRejectsDocxXMLExpandingPastLimit(t *testing.T) {
	bomb := buildDocx(t, "word/document.xml", bytes.Repeat([]byte("a"), MaxUploadBytes+1))
	// 上传体本身很小（被 deflate 压扁了），所以过得了体积检查——
	// 真正被拦下的是解压后的 document.xml。
	if len(bomb) > MaxUploadBytes {
		t.Fatalf("测试前提不成立：压缩后的炸弹 %d 字节已超过上传上限", len(bomb))
	}
	_, err := ParseDocument("resume.docx", bomb)
	if err == nil || !strings.Contains(err.Error(), "expands beyond the upload limit") {
		t.Fatalf("zip 炸弹错误 = %v，期望 expands beyond the upload limit", err)
	}
}

func TestParseDocumentRejectsInvalidDocxArchive(t *testing.T) {
	_, err := ParseDocument("resume.docx", []byte("this is not a zip"))
	if err == nil || !strings.Contains(err.Error(), "invalid docx archive") {
		t.Fatalf("坏 zip 错误 = %v，期望 invalid docx archive", err)
	}
}

func TestParseDocumentRejectsDocxMissingDocumentXML(t *testing.T) {
	docx := buildDocx(t, "word/styles.xml", []byte("<w:styles/>"))
	_, err := ParseDocument("resume.docx", docx)
	if err == nil || !strings.Contains(err.Error(), "docx is missing word/document.xml") {
		t.Fatalf("缺 document.xml 错误 = %v", err)
	}
}

func TestParseDocumentRejectsNonUTF8Docx(t *testing.T) {
	docx := buildDocx(t, "word/document.xml", []byte{0xff, 0xfe, 0xfd})
	_, err := ParseDocument("resume.docx", docx)
	if err == nil || !strings.Contains(err.Error(), "is not valid UTF-8") {
		t.Fatalf("非法 UTF-8 错误 = %v", err)
	}
}

func TestParseDocumentExtractsDocxText(t *testing.T) {
	docx := buildDocx(t, "word/document.xml",
		[]byte("<w:body><w:p><w:t>Alice Chen</w:t></w:p><w:p><w:t>Engineer</w:t></w:p></w:body>"))
	doc, err := ParseDocument("Resume.DOCX", docx)
	if err != nil {
		t.Fatalf("不该报错：%v", err)
	}
	if doc.Text != "Alice Chen\nEngineer" {
		t.Fatalf("Text = %q", doc.Text)
	}
	// 短文本自然被判成疑似扫描件。
	if !doc.LikelyScanned {
		t.Fatal("短文档应当被标记为 likely_scanned")
	}
}

func TestParseDocumentRejectsInvalidPDF(t *testing.T) {
	_, err := ParseDocument("resume.pdf", []byte("%PDF-1.4 garbage that is not parseable"))
	if err == nil || !strings.Contains(err.Error(), "pdf text extraction failed") {
		t.Fatalf("坏 PDF 错误 = %v，期望 pdf text extraction failed", err)
	}
}

func TestParseDocumentExtractsPDFText(t *testing.T) {
	doc, err := ParseDocument("resume.pdf", minimalPDF("Hello World"))
	if err != nil {
		t.Fatalf("不该报错：%v", err)
	}
	if !strings.Contains(doc.Text, "Hello World") {
		t.Fatalf("PDF 抽取 = %q，期望含 Hello World", doc.Text)
	}
	if doc.CharCount != countRunes(doc.Text) {
		t.Fatalf("CharCount = %d，期望 %d", doc.CharCount, countRunes(doc.Text))
	}
}

// buildDocx 在内存里造一个只有一个条目的 docx（zip）。
func buildDocx(t *testing.T, name string, content []byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	entry, err := writer.Create(name)
	if err != nil {
		t.Fatalf("创建 zip 条目：%v", err)
	}
	if _, err := entry.Write(content); err != nil {
		t.Fatalf("写入 zip 条目：%v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("关闭 zip：%v", err)
	}
	return buffer.Bytes()
}

// minimalPDF 手搓一份最小可解析的 PDF，用于验证 PDF 分支真的接通了。
// xref 偏移按写入顺序现算，保证结构自洽。
func minimalPDF(text string) []byte {
	var out bytes.Buffer
	offsets := make([]int, 0, 5)

	writeObject := func(number int, body string) {
		offsets = append(offsets, out.Len())
		fmt.Fprintf(&out, "%d 0 obj\n%s\nendobj\n", number, body)
	}

	out.WriteString("%PDF-1.4\n")
	writeObject(1, "<< /Type /Catalog /Pages 2 0 R >>")
	writeObject(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
	writeObject(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "+
		"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>")
	writeObject(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	content := fmt.Sprintf("BT /F1 24 Tf 72 720 Td (%s) Tj ET", text)
	writeObject(5, fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(content), content))

	xrefOffset := out.Len()
	out.WriteString("xref\n0 6\n")
	out.WriteString("0000000000 65535 f \n")
	for _, offset := range offsets {
		fmt.Fprintf(&out, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&out, "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", xrefOffset)
	return out.Bytes()
}
