use std::collections::HashMap;
use std::io::Cursor;

use calamine::{Reader, Xlsx, open_workbook_from_rs};
use rust_xlsxwriter::{Format, Workbook, Worksheet};
use uuid::Uuid;

use crate::middleware::error::AppError;
use crate::models::{Card, CardExample, Deck, ImportErrorItem};

pub const EXAMPLE_TRANSLATION_PLACEHOLDER: &str = "（暂无中文翻译）";

const DECKS_SHEET: &str = "Decks";
const CARDS_SHEET: &str = "Cards";

const DECK_HEADERS: &[&str] = &["name", "description", "color", "source_key"];
const CARD_HEADERS: &[&str] = &["deck_name", "front", "back", "example", "pronunciation", "tags"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedDeckRow {
    pub row: u32,
    pub name: String,
    pub description: String,
    pub color: Option<String>,
    pub source_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedCardRow {
    pub row: u32,
    pub deck_name: String,
    pub front: String,
    pub back: String,
    pub example: Option<String>,
    pub pronunciation: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct VocabularyExport {
    pub decks: Vec<Deck>,
    pub cards: Vec<Card>,
}

pub fn parse_tags(raw: Option<&str>) -> Vec<String> {
    raw.map(|value| {
        value
            .split(',')
            .map(str::trim)
            .filter(|tag| !tag.is_empty())
            .map(str::to_string)
            .collect()
    })
    .unwrap_or_default()
}

pub fn validate_import_rows(
    decks: &[ParsedDeckRow],
    cards: &[ParsedCardRow],
) -> Vec<ImportErrorItem> {
    let mut errors = Vec::new();

    for deck in decks {
        if deck.name.trim().is_empty() {
            errors.push(ImportErrorItem {
                sheet: DECKS_SHEET.to_string(),
                row: deck.row,
                field: "name".to_string(),
                message: "Deck name is required".to_string(),
            });
        }
        if deck.description.trim().is_empty() {
            errors.push(ImportErrorItem {
                sheet: DECKS_SHEET.to_string(),
                row: deck.row,
                field: "description".to_string(),
                message: "Deck description is required".to_string(),
            });
        }
    }

    let deck_names: std::collections::HashSet<&str> =
        decks.iter().map(|deck| deck.name.as_str()).collect();

    for card in cards {
        if card.deck_name.trim().is_empty() {
            errors.push(ImportErrorItem {
                sheet: CARDS_SHEET.to_string(),
                row: card.row,
                field: "deck_name".to_string(),
                message: "deck_name is required".to_string(),
            });
            continue;
        }
        if !deck_names.contains(card.deck_name.as_str()) {
            errors.push(ImportErrorItem {
                sheet: CARDS_SHEET.to_string(),
                row: card.row,
                field: "deck_name".to_string(),
                message: format!("deck_name '{}' does not match any deck in the Decks sheet", card.deck_name),
            });
        }
        if card.front.trim().is_empty() {
            errors.push(ImportErrorItem {
                sheet: CARDS_SHEET.to_string(),
                row: card.row,
                field: "front".to_string(),
                message: "front is required".to_string(),
            });
        }
        if card.back.trim().is_empty() {
            errors.push(ImportErrorItem {
                sheet: CARDS_SHEET.to_string(),
                row: card.row,
                field: "back".to_string(),
                message: "back is required".to_string(),
            });
        }
    }

    errors
}

pub fn parse_import_xlsx(data: &[u8]) -> Result<(Vec<ParsedDeckRow>, Vec<ParsedCardRow>), AppError> {
    let cursor = Cursor::new(data.to_vec());
    let mut workbook: Xlsx<_> = open_workbook_from_rs(cursor)
        .map_err(|err| AppError::BadRequest(format!("Invalid xlsx file: {err}")))?;

    let decks = parse_decks_sheet(&mut workbook)?;
    let cards = parse_cards_sheet(&mut workbook)?;
    Ok((decks, cards))
}

fn parse_decks_sheet(workbook: &mut Xlsx<Cursor<Vec<u8>>>) -> Result<Vec<ParsedDeckRow>, AppError> {
    let range = workbook
        .worksheet_range(DECKS_SHEET)
        .map_err(|err| AppError::BadRequest(format!("Failed to read '{DECKS_SHEET}' sheet: {err}")))?;

    let headers = decks_header_map(&range, DECKS_SHEET)?;
    let mut rows = Vec::new();

    for (idx, row) in range.rows().enumerate().skip(1) {
        let excel_row = (idx + 1) as u32;
        if row_is_empty(row) {
            continue;
        }

        rows.push(ParsedDeckRow {
            row: excel_row,
            name: cell_string(row, headers.get("name"), DECKS_SHEET, excel_row, "name")?,
            description: cell_string(
                row,
                headers.get("description"),
                DECKS_SHEET,
                excel_row,
                "description",
            )?,
            color: optional_cell_string(row, headers.get("color")),
            source_key: optional_cell_string(row, headers.get("source_key")),
        });
    }

    Ok(rows)
}

fn parse_cards_sheet(workbook: &mut Xlsx<Cursor<Vec<u8>>>) -> Result<Vec<ParsedCardRow>, AppError> {
    let range = workbook
        .worksheet_range(CARDS_SHEET)
        .map_err(|err| AppError::BadRequest(format!("Failed to read '{CARDS_SHEET}' sheet: {err}")))?;

    let headers = cards_header_map(&range, CARDS_SHEET)?;
    let mut rows = Vec::new();

    for (idx, row) in range.rows().enumerate().skip(1) {
        let excel_row = (idx + 1) as u32;
        if row_is_empty(row) {
            continue;
        }

        let tags_raw = optional_cell_string(row, headers.get("tags"));
        rows.push(ParsedCardRow {
            row: excel_row,
            deck_name: cell_string(
                row,
                headers.get("deck_name"),
                CARDS_SHEET,
                excel_row,
                "deck_name",
            )?,
            front: cell_string(row, headers.get("front"), CARDS_SHEET, excel_row, "front")?,
            back: cell_string(row, headers.get("back"), CARDS_SHEET, excel_row, "back")?,
            example: optional_cell_string(row, headers.get("example")),
            pronunciation: optional_cell_string(row, headers.get("pronunciation")),
            tags: parse_tags(tags_raw.as_deref()),
        });
    }

    Ok(rows)
}

fn header_map(
    range: &calamine::Range<calamine::Data>,
    sheet: &str,
    header_row: u32,
) -> Result<HashMap<String, usize>, AppError> {
    let row_idx = (header_row - 1) as usize;
    let Some(header_row_cells) = range.rows().nth(row_idx) else {
        return Err(AppError::BadRequest(format!(
            "Sheet '{sheet}' is missing a header row"
        )));
    };

    let mut headers = HashMap::new();
    for (idx, cell) in header_row_cells.iter().enumerate() {
        let name = cell_to_string(cell).trim().to_ascii_lowercase();
        if !name.is_empty() {
            headers.insert(name, idx);
        }
    }

    Ok(headers)
}

fn decks_header_map(
    range: &calamine::Range<calamine::Data>,
    sheet: &str,
) -> Result<HashMap<String, usize>, AppError> {
    let headers = header_map(range, sheet, 1)?;
    for required in ["name", "description"] {
        if !headers.contains_key(required) {
            return Err(AppError::BadRequest(format!(
                "Sheet '{sheet}' is missing required column '{required}'"
            )));
        }
    }
    Ok(headers)
}

fn cards_header_map(
    range: &calamine::Range<calamine::Data>,
    sheet: &str,
) -> Result<HashMap<String, usize>, AppError> {
    let headers = header_map(range, sheet, 1)?;
    for required in ["deck_name", "front", "back"] {
        if !headers.contains_key(required) {
            return Err(AppError::BadRequest(format!(
                "Sheet '{sheet}' is missing required column '{required}'"
            )));
        }
    }
    Ok(headers)
}

fn cell_string(
    row: &[calamine::Data],
    index: Option<&usize>,
    sheet: &str,
    _excel_row: u32,
    field: &str,
) -> Result<String, AppError> {
    let Some(index) = index else {
        return Err(AppError::BadRequest(format!(
            "Sheet '{sheet}' is missing column '{field}'"
        )));
    };
    Ok(row
        .get(*index)
        .map(cell_to_string)
        .unwrap_or_default()
        .trim()
        .to_string())
}

fn optional_cell_string(row: &[calamine::Data], index: Option<&usize>) -> Option<String> {
    let index = *index?;
    let value = row.get(index).map(cell_to_string).unwrap_or_default();
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn cell_to_string(cell: &calamine::Data) -> String {
    match cell {
        calamine::Data::Empty => String::new(),
        calamine::Data::String(value) => value.clone(),
        calamine::Data::Float(value) => {
            if value.fract() == 0.0 {
                format!("{value:.0}")
            } else {
                value.to_string()
            }
        }
        calamine::Data::Int(value) => value.to_string(),
        calamine::Data::Bool(value) => value.to_string(),
        calamine::Data::DateTime(value) => value.to_string(),
        calamine::Data::DateTimeIso(value) => value.clone(),
        calamine::Data::DurationIso(value) => value.clone(),
        calamine::Data::Error(_) => String::new(),
    }
}

fn row_is_empty(row: &[calamine::Data]) -> bool {
    row.iter().all(|cell| cell_to_string(cell).trim().is_empty())
}

/// 例句单元格的格式：一条例句一行，多条例句用换行分隔。
/// 每行是 `英文` 或 `英文|中文`；没有中文译文时（含历史文件）按占位符处理。
pub fn examples_to_excel_text(examples: &[CardExample]) -> String {
    examples
        .iter()
        .map(|example| {
            let sentence_en = example.sentence_en.trim();
            let translation_zh = example.translation_zh.trim();
            if translation_zh.is_empty() || translation_zh == EXAMPLE_TRANSLATION_PLACEHOLDER {
                sentence_en.to_string()
            } else {
                format!("{sentence_en}|{translation_zh}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn examples_from_import_text(text: &str) -> Vec<CardExample> {
    text.split('\n')
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let (sentence_en, translation_zh) = match line.split_once('|') {
                Some((sentence_en, translation_zh)) => (sentence_en.trim(), translation_zh.trim()),
                None => (line, ""),
            };
            if sentence_en.is_empty() {
                return None;
            }
            Some(CardExample {
                id: format!("ex_{}", Uuid::new_v4().simple()),
                sentence_en: sentence_en.to_string(),
                translation_zh: if translation_zh.is_empty() {
                    EXAMPLE_TRANSLATION_PLACEHOLDER.to_string()
                } else {
                    translation_zh.to_string()
                },
            })
        })
        .collect()
}

pub fn build_template_xlsx() -> Result<Vec<u8>, AppError> {
    let mut workbook = Workbook::new();
    write_decks_sheet(&mut workbook, &[
        ["示例卡组", "这是示例描述", "#4A90E2", "example-deck"],
    ])?;
    write_cards_sheet(&mut workbook, &[[
        "示例卡组",
        "hello",
        "你好",
        "Hello world.",
        "/həˈloʊ/",
        "basic,greeting",
    ]])?;
    workbook
        .save_to_buffer()
        .map_err(|err| AppError::Internal(format!("Failed to build template xlsx: {err}")))
}

pub fn build_export_xlsx(decks: &[Deck], cards: &[Card]) -> Result<Vec<u8>, AppError> {
    let deck_name_by_id: HashMap<&str, &str> = decks
        .iter()
        .map(|deck| (deck.id.as_str(), deck.name.as_str()))
        .collect();

    let deck_rows: Vec<[String; 4]> = decks
        .iter()
        .map(|deck| {
            [
                deck.name.clone(),
                deck.description.clone(),
                deck.color.clone().unwrap_or_default(),
                deck.source_key.clone().unwrap_or_default(),
            ]
        })
        .collect();

    let deck_refs: Vec<[&str; 4]> = deck_rows
        .iter()
        .map(|row| [row[0].as_str(), row[1].as_str(), row[2].as_str(), row[3].as_str()])
        .collect();

    let card_rows: Vec<[String; 6]> = cards
        .iter()
        .map(|card| {
            [
                deck_name_by_id
                    .get(card.deck_id.as_str())
                    .copied()
                    .unwrap_or_default()
                    .to_string(),
                card.front.clone(),
                card.back.clone(),
                examples_to_excel_text(&card.examples),
                card.pronunciation.clone().unwrap_or_default(),
                card.tags.join(","),
            ]
        })
        .collect();

    let card_refs: Vec<[&str; 6]> = card_rows
        .iter()
        .map(|row| {
            [
                row[0].as_str(),
                row[1].as_str(),
                row[2].as_str(),
                row[3].as_str(),
                row[4].as_str(),
                row[5].as_str(),
            ]
        })
        .collect();

    let mut workbook = Workbook::new();
    write_decks_sheet(
        &mut workbook,
        &deck_refs
            .iter()
            .map(|row| [row[0], row[1], row[2], row[3]])
            .collect::<Vec<_>>(),
    )?;
    write_cards_sheet(
        &mut workbook,
        &card_refs
            .iter()
            .map(|row| [row[0], row[1], row[2], row[3], row[4], row[5]])
            .collect::<Vec<_>>(),
    )?;
    workbook
        .save_to_buffer()
        .map_err(|err| AppError::Internal(format!("Failed to build export xlsx: {err}")))
}

fn write_decks_sheet(
    workbook: &mut Workbook,
    rows: &[[&str; 4]],
) -> Result<(), AppError> {
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name(DECKS_SHEET)
        .map_err(|err| AppError::Internal(format!("Failed to name decks sheet: {err}")))?;

    write_header_row(worksheet, DECK_HEADERS)?;
    for (row_idx, row) in rows.iter().enumerate() {
        let excel_row = (row_idx + 1) as u32;
        for (col_idx, value) in row.iter().enumerate() {
            worksheet
                .write_string(excel_row, col_idx as u16, *value)
                .map_err(|err| AppError::Internal(format!("Failed to write deck row: {err}")))?;
        }
    }
    Ok(())
}

fn write_cards_sheet(
    workbook: &mut Workbook,
    rows: &[[&str; 6]],
) -> Result<(), AppError> {
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name(CARDS_SHEET)
        .map_err(|err| AppError::Internal(format!("Failed to name cards sheet: {err}")))?;

    write_header_row(worksheet, CARD_HEADERS)?;
    for (row_idx, row) in rows.iter().enumerate() {
        let excel_row = (row_idx + 1) as u32;
        for (col_idx, value) in row.iter().enumerate() {
            worksheet
                .write_string(excel_row, col_idx as u16, *value)
                .map_err(|err| AppError::Internal(format!("Failed to write card row: {err}")))?;
        }
    }
    Ok(())
}

fn write_header_row(worksheet: &mut Worksheet, headers: &[&str]) -> Result<(), AppError> {
    let header_format = Format::new().set_bold();
    for (col_idx, header) in headers.iter().enumerate() {
        worksheet
            .write_string_with_format(0, col_idx as u16, *header, &header_format)
            .map_err(|err| AppError::Internal(format!("Failed to write header: {err}")))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_import_rows_flags_missing_deck_name() {
        let decks = vec![ParsedDeckRow {
            row: 2,
            name: " ".to_string(),
            description: "desc".to_string(),
            color: None,
            source_key: None,
        }];
        let errors = validate_import_rows(&decks, &[]);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].sheet, "Decks");
        assert_eq!(errors[0].field, "name");
    }

    #[test]
    fn validate_import_rows_flags_unmatched_deck_name() {
        let decks = vec![ParsedDeckRow {
            row: 2,
            name: "Core".to_string(),
            description: "desc".to_string(),
            color: None,
            source_key: None,
        }];
        let cards = vec![ParsedCardRow {
            row: 2,
            deck_name: "Missing".to_string(),
            front: "hello".to_string(),
            back: "你好".to_string(),
            example: None,
            pronunciation: None,
            tags: vec![],
        }];
        let errors = validate_import_rows(&decks, &cards);
        assert!(errors.iter().any(|err| err.field == "deck_name"));
    }

    #[test]
    fn parse_tags_splits_and_trims_commas() {
        assert_eq!(
            parse_tags(Some("a, b , ,c")),
            vec!["a".to_string(), "b".to_string(), "c".to_string()]
        );
        assert!(parse_tags(None).is_empty());
    }

    #[test]
    fn build_template_xlsx_produces_bytes() {
        let bytes = build_template_xlsx().expect("template should build");
        assert!(!bytes.is_empty());
        let (decks, cards) = parse_import_xlsx(&bytes).expect("template should parse");
        assert_eq!(decks.len(), 1);
        assert_eq!(cards.len(), 1);
        assert_eq!(decks[0].name, "示例卡组");
        assert_eq!(cards[0].tags, vec!["basic", "greeting"]);
    }

    #[test]
    fn examples_from_import_text_pairs_english_and_chinese() {
        let examples = examples_from_import_text("Excuse me!|打扰一下！");
        assert_eq!(examples.len(), 1);
        assert_eq!(examples[0].sentence_en, "Excuse me!");
        assert_eq!(examples[0].translation_zh, "打扰一下！");
        assert!(examples[0].id.starts_with("ex_"));
    }

    #[test]
    fn examples_from_import_text_handles_multiple_lines_and_missing_translation() {
        let examples = examples_from_import_text("Is this your handbag?|这是你的手提包吗？\n\n Thank you very much. \n");
        assert_eq!(examples.len(), 2);
        assert_eq!(examples[0].translation_zh, "这是你的手提包吗？");
        assert_eq!(examples[1].sentence_en, "Thank you very much.");
        assert_eq!(examples[1].translation_zh, EXAMPLE_TRANSLATION_PLACEHOLDER);
    }

    #[test]
    fn examples_from_import_text_returns_empty_for_blank_cell() {
        assert!(examples_from_import_text("   ").is_empty());
        assert!(examples_from_import_text("").is_empty());
    }

    #[test]
    fn examples_round_trip_through_excel_text() {
        let examples = vec![
            CardExample {
                id: "ex_1".to_string(),
                sentence_en: "Excuse me!".to_string(),
                translation_zh: "打扰一下！".to_string(),
            },
            CardExample {
                id: "ex_2".to_string(),
                sentence_en: "Yes it is.".to_string(),
                translation_zh: EXAMPLE_TRANSLATION_PLACEHOLDER.to_string(),
            },
        ];
        let text = examples_to_excel_text(&examples);
        assert_eq!(text, "Excuse me!|打扰一下！\nYes it is.");
        let parsed = examples_from_import_text(&text);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].sentence_en, "Excuse me!");
        assert_eq!(parsed[0].translation_zh, "打扰一下！");
        assert_eq!(parsed[1].translation_zh, EXAMPLE_TRANSLATION_PLACEHOLDER);
    }
}
