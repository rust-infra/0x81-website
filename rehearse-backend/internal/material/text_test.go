package material

import (
	"archive/zip"
	"bytes"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// 本文件对齐 `interview_docs.rs` 的 #[cfg(test)] 块，并补上 Rust 没写但
// 会在线上咬人的边界：空上传、超限上传、缺 document.xml、坏 zip、
// 非法 UTF-8、以及 PDF 的成败两条路径。

// 对齐 Rust 的 `docx_xml_to_text_keeps_paragraph_breaks`（interview_docs.rs:124）。
func TestDocxXMLToTextKeepsParagraphBreaks(t *testing.T) {
	xml := "<w:body><w:p><w:r><w:t>Alice Chen</w:t></w:r></w:p>" +
		"<w:p><w:r><w:t>Backend Engineer</w:t></w:r></w:p></w:body>"
	require.Equal(t, "Alice Chen\nBackend Engineer", DocxXMLToText(xml), "DocxXMLToText 期望两段各一行")
}

// 对齐 Rust 的 `docx_xml_decodes_entities`（interview_docs.rs:131）。
func TestDocxXMLToTextDecodesEntities(t *testing.T) {
	require.Equal(t, "A & B <C>", DocxXMLToText("<w:t>A &amp; B &lt;C&gt;</w:t>"), "实体解码")
}

// <w:br/> 与 <w:tab/> 要在去标签之前换成换行 / 制表符，否则整段会糊成一行。
func TestDocxXMLToTextHandlesBreaksAndTabs(t *testing.T) {
	got := DocxXMLToText("<w:p><w:r><w:t>line1</w:t><w:br/><w:t>line2</w:t></w:r></w:p>")
	require.Equal(t, "line1\nline2", got, "<w:br/> 处理")

	// 行内 tab 会保留，但行首行尾的会被逐行 trim 掉（Rust 同样如此）。
	got = DocxXMLToText("<w:t>a<w:tab/>b</w:t>")
	require.Equal(t, "a\tb", got, "<w:tab/> 处理")
}

// 转义过的标签必须保留成字面文本——这钉住「先去掉真标签、再解实体」的顺序。
func TestDocxXMLToTextPreservesEscapedTags(t *testing.T) {
	require.Equal(t, "<w:p>", DocxXMLToText("<w:t>&lt;w:p&gt;</w:t>"), "转义标签")
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
			require.Equalf(t, tc.want, IsLikelyScanned(tc.text),
				"IsLikelyScanned(%d 字)", countRunes(tc.text))
		})
	}
}

// 字符数按 rune 算：3 个汉字是 3 个字符而不是 9 个字节。
func TestParseDocumentCharCountIsRunes(t *testing.T) {
	docx := buildDocx(t, "word/document.xml", []byte("<w:p><w:t>你好世界</w:t></w:p>"))
	doc, err := ParseDocument("resume.docx", docx)
	require.NoError(t, err, "不该报错")
	require.Equal(t, 4, doc.CharCount, "CharCount 期望 4（按 rune）")
}

func TestParseDocumentRejectsEmptyUpload(t *testing.T) {
	_, err := ParseDocument("resume.pdf", nil)
	require.Error(t, err, "空上传应当报错")
	require.Contains(t, err.Error(), "uploaded file is empty", "空上传错误")
}

func TestParseDocumentRejectsOversizeUpload(t *testing.T) {
	oversize := make([]byte, MaxUploadBytes+1)
	_, err := ParseDocument("resume.pdf", oversize)
	require.Error(t, err, "超限上传应当报错")
	require.Contains(t, err.Error(), "uploaded file is too large", "超限上传错误")
}

// 对齐 Rust 的 `rejects_unknown_extension`（interview_docs.rs:163）。
func TestParseDocumentRejectsUnknownExtension(t *testing.T) {
	_, err := ParseDocument("resume.txt", []byte("hello"))
	require.Error(t, err, "未知后缀应当报错")
	require.Contains(t, err.Error(), "only .pdf and .docx are supported", "未知后缀错误")
}

// 对齐 Rust 的 `rejects_docx_xml_that_expands_past_limit`（interview_docs.rs:146）。
// 压缩率极高的 docx 解压后能撑爆内存，护栏必须在读完之前生效。
func TestParseDocumentRejectsDocxXMLExpandingPastLimit(t *testing.T) {
	bomb := buildDocx(t, "word/document.xml", bytes.Repeat([]byte("a"), MaxUploadBytes+1))
	// 上传体本身很小（被 deflate 压扁了），所以过得了体积检查——
	// 真正被拦下的是解压后的 document.xml。
	require.LessOrEqual(t, len(bomb), MaxUploadBytes, "测试前提：压缩后的炸弹应不超过上传上限")
	_, err := ParseDocument("resume.docx", bomb)
	require.Error(t, err, "zip 炸弹应当报错")
	require.Contains(t, err.Error(), "expands beyond the upload limit", "zip 炸弹错误")
}

func TestParseDocumentRejectsInvalidDocxArchive(t *testing.T) {
	_, err := ParseDocument("resume.docx", []byte("this is not a zip"))
	require.Error(t, err, "坏 zip 应当报错")
	require.Contains(t, err.Error(), "invalid docx archive", "坏 zip 错误")
}

func TestParseDocumentRejectsDocxMissingDocumentXML(t *testing.T) {
	docx := buildDocx(t, "word/styles.xml", []byte("<w:styles/>"))
	_, err := ParseDocument("resume.docx", docx)
	require.Error(t, err, "缺 document.xml 应当报错")
	require.Contains(t, err.Error(), "docx is missing word/document.xml", "缺 document.xml 错误")
}

func TestParseDocumentRejectsNonUTF8Docx(t *testing.T) {
	docx := buildDocx(t, "word/document.xml", []byte{0xff, 0xfe, 0xfd})
	_, err := ParseDocument("resume.docx", docx)
	require.Error(t, err, "非法 UTF-8 应当报错")
	require.Contains(t, err.Error(), "is not valid UTF-8", "非法 UTF-8 错误")
}

func TestParseDocumentExtractsDocxText(t *testing.T) {
	docx := buildDocx(t, "word/document.xml",
		[]byte("<w:body><w:p><w:t>Alice Chen</w:t></w:p><w:p><w:t>Engineer</w:t></w:p></w:body>"))
	doc, err := ParseDocument("Resume.DOCX", docx)
	require.NoError(t, err, "不该报错")
	require.Equal(t, "Alice Chen\nEngineer", doc.Text, "Text")
	// 短文本自然被判成疑似扫描件。
	require.True(t, doc.LikelyScanned, "短文档应当被标记为 likely_scanned")
}

func TestParseDocumentRejectsInvalidPDF(t *testing.T) {
	_, err := ParseDocument("resume.pdf", []byte("%PDF-1.4 garbage that is not parseable"))
	require.Error(t, err, "坏 PDF 应当报错")
	require.Contains(t, err.Error(), "pdf text extraction failed", "坏 PDF 错误")
}

func TestParseDocumentExtractsPDFText(t *testing.T) {
	doc, err := ParseDocument("resume.pdf", minimalPDF("Hello World"))
	require.NoError(t, err, "不该报错")
	require.Contains(t, doc.Text, "Hello World", "PDF 抽取")
	require.Equal(t, countRunes(doc.Text), doc.CharCount, "CharCount")
}

// buildDocx 在内存里造一个只有一个条目的 docx（zip）。
func buildDocx(t *testing.T, name string, content []byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	entry, err := writer.Create(name)
	require.NoError(t, err, "创建 zip 条目")
	_, err = entry.Write(content)
	require.NoError(t, err, "写入 zip 条目")
	require.NoError(t, writer.Close(), "关闭 zip")
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
