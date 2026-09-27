//! 面试材料（PDF / DOCX）纯文本抽取。
//!
//! 隐私：只在内存中处理，不落盘、不把内容写进日志。抽取失败一律返回
//! `BadRequest`，错误信息只含错误类型，不含材料内容。

use std::io::Read;

use serde::Serialize;

use crate::middleware::error::AppError;

/// 低于这个字符数就认为多半是扫描件，App 会提示改用图片上传。
pub const SCANNED_TEXT_THRESHOLD: usize = 200;

const MAX_UPLOAD_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct ParsedDocument {
    pub text: String,
    pub char_count: usize,
    pub likely_scanned: bool,
}

pub fn is_likely_scanned(text: &str) -> bool {
    text.chars().count() < SCANNED_TEXT_THRESHOLD
}

/// 去标签、解实体、按段分行——DOCX 正文在 `word/document.xml` 里。
pub fn docx_xml_to_text(xml: &str) -> String {
    let with_breaks = xml
        .replace("</w:p>", "\n")
        .replace("<w:br/>", "\n")
        .replace("<w:tab/>", "\t");

    let mut out = String::new();
    let mut in_tag = false;
    for ch in with_breaks.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }

    let decoded = out
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'");

    decoded
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn parse_docx(bytes: &[u8]) -> Result<String, AppError> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|_| AppError::BadRequest("invalid docx archive".into()))?;
    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|_| AppError::BadRequest("docx is missing word/document.xml".into()))?
        .read_to_string(&mut xml)
        .map_err(|_| AppError::BadRequest("docx document.xml is not valid UTF-8".into()))?;
    Ok(docx_xml_to_text(&xml))
}

fn parse_pdf(bytes: &[u8]) -> Result<String, AppError> {
    let text = pdf_extract::extract_text_from_mem(bytes)
        .map_err(|_| AppError::BadRequest("pdf text extraction failed".into()))?;
    let normalized = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Ok(normalized)
}

pub fn parse_document(file_name: &str, bytes: &[u8]) -> Result<ParsedDocument, AppError> {
    if bytes.is_empty() {
        return Err(AppError::BadRequest("uploaded file is empty".into()));
    }
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err(AppError::BadRequest("uploaded file is too large".into()));
    }

    let lower = file_name.to_ascii_lowercase();
    let text = if lower.ends_with(".pdf") {
        parse_pdf(bytes)?
    } else if lower.ends_with(".docx") {
        parse_docx(bytes)?
    } else {
        return Err(AppError::BadRequest(
            "only .pdf and .docx are supported; use paste or photos otherwise".into(),
        ));
    };

    let likely_scanned = is_likely_scanned(&text);
    Ok(ParsedDocument {
        char_count: text.chars().count(),
        text,
        likely_scanned,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn docx_xml_to_text_keeps_paragraph_breaks() {
        let xml = "<w:body><w:p><w:r><w:t>Alice Chen</w:t></w:r></w:p>\
                   <w:p><w:r><w:t>Backend Engineer</w:t></w:r></w:p></w:body>";
        assert_eq!(docx_xml_to_text(xml), "Alice Chen\nBackend Engineer");
    }

    #[test]
    fn docx_xml_decodes_entities() {
        assert_eq!(
            docx_xml_to_text("<w:t>A &amp; B &lt;C&gt;</w:t>"),
            "A & B <C>"
        );
    }

    #[test]
    fn short_text_is_flagged_as_likely_scanned() {
        assert!(is_likely_scanned("page 1"));
        assert!(!is_likely_scanned(&"字".repeat(SCANNED_TEXT_THRESHOLD + 1)));
    }

    #[test]
    fn rejects_unknown_extension() {
        assert!(parse_document("resume.txt", b"hello").is_err());
    }
}
