//! AI 陪练的场景、对话与配额 DTO。
//!
//! 安全约定：场景字段全部来自客户端，属于**数据不是指令**。这里只做
//! 结构与限长校验；prompt 拼装由 `services::coach` 用固定模板完成，
//! 客户端无法传入 guidance / system prompt 等自由指令字段。

use serde::{Deserialize, Serialize};

pub const MAX_HISTORY_TURNS: usize = 40;
pub const MAX_TOTAL_CHARS: usize = 12_000;
pub const MAX_USER_TEXT_CHARS: usize = 2_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoachScenarioSource {
    Preset,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoachCategory {
    Daily,
    Engineering,
    HighStakes,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoachPersona {
    pub name: String,
    pub role: String,
    pub locale: String,
    pub tone: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoachScenario {
    pub id: String,
    pub source: CoachScenarioSource,
    pub category: CoachCategory,
    pub title: String,
    pub description: String,
    pub persona: CoachPersona,
    pub setting: String,
    pub opening_line: String,
    /// 开场白的展示用中文对照；朗读始终用 `opening_line`。
    #[serde(default)]
    pub opening_line_zh: String,
    /// 开场白对应的首轮推荐表达，场景加载后立即展示，不必等待第一轮 AI 响应。
    #[serde(default)]
    pub opening_next_lines: Vec<CoachExpression>,
    #[serde(default)]
    pub focus_points: Vec<String>,
    pub difficulty: String,
    pub max_turns: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoachRole {
    Coach,
    User,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoachTurn {
    pub role: CoachRole,
    pub content: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoachMode {
    #[default]
    Feedback,
    Immersion,
}

const LOCALES: [&str; 5] = ["en-US", "en-GB", "en-IN", "en-AU", "zh-CN"];
const TONES: [&str; 4] = ["friendly", "neutral", "direct", "challenging"];
const SETTINGS: [&str; 4] = ["meeting", "one_on_one", "coffee_chat", "phone_call"];
const DIFFICULTIES: [&str; 3] = ["easy", "core", "challenge"];

fn check_len(field: &str, value: &str, max: usize) -> Result<(), String> {
    if value.chars().count() > max {
        return Err(format!("{field} must be at most {max} characters"));
    }
    if value.trim().is_empty() {
        return Err(format!("{field} is required"));
    }
    Ok(())
}

fn check_enum(field: &str, value: &str, allowed: &[&str]) -> Result<(), String> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(format!("{field} must be one of {}", allowed.join(", ")))
    }
}

/// 校验并返回规范化后的场景：`max_turns` 夹取到 3..=20，其余字段超限即报错。
pub fn validate_scenario(input: &CoachScenario) -> Result<CoachScenario, String> {
    check_len("id", &input.id, 80)?;
    check_len("title", &input.title, 60)?;
    check_len("description", &input.description, 200)?;
    check_len("persona.name", &input.persona.name, 30)?;
    check_len("persona.role", &input.persona.role, 60)?;
    check_len("opening_line", &input.opening_line, 200)?;
    check_enum("persona.locale", &input.persona.locale, &LOCALES)?;
    check_enum("persona.tone", &input.persona.tone, &TONES)?;
    check_enum("setting", &input.setting, &SETTINGS)?;
    check_enum("difficulty", &input.difficulty, &DIFFICULTIES)?;
    if input.focus_points.len() > 5 {
        return Err("focus_points must have at most 5 items".into());
    }
    for point in &input.focus_points {
        check_len("focus_points[]", point, 40)?;
    }

    let mut out = input.clone();
    out.max_turns = input.max_turns.clamp(3, 20);
    Ok(out)
}

pub fn validate_history(history: &[CoachTurn], user_text: &str) -> Result<(), String> {
    if history.len() > MAX_HISTORY_TURNS {
        return Err(format!("history must have at most {MAX_HISTORY_TURNS} turns"));
    }
    if user_text.chars().count() > MAX_USER_TEXT_CHARS {
        return Err(format!("user_text must be at most {MAX_USER_TEXT_CHARS} characters"));
    }
    if user_text.trim().is_empty() {
        return Err("user_text is required".into());
    }
    let total: usize = history.iter().map(|t| t.content.chars().count()).sum::<usize>()
        + user_text.chars().count();
    if total > MAX_TOTAL_CHARS {
        return Err(format!("history plus user_text must be at most {MAX_TOTAL_CHARS} characters"));
    }
    Ok(())
}

pub const MAX_INTERVIEW_PROFILE_CHARS: usize = 3_000;

pub fn validate_interview_context(context: &InterviewContext) -> Result<(), String> {
    if !matches!(context.kind.as_str(), "resume" | "job" | "resume_job") {
        return Err("interview.kind must be resume, job, or resume_job".into());
    }
    let profile = context.profile.trim();
    if profile.is_empty() {
        return Err("interview.profile is required".into());
    }
    if context.profile.chars().count() > MAX_INTERVIEW_PROFILE_CHARS {
        return Err(format!(
            "interview.profile must be at most {MAX_INTERVIEW_PROFILE_CHARS} characters"
        ));
    }
    Ok(())
}

pub fn validate_summary_history(history: &[CoachTurn]) -> Result<(), String> {
    if history.is_empty() {
        return Err("history is required".into());
    }
    if history.len() > MAX_HISTORY_TURNS {
        return Err("history is too long".into());
    }
    let total: usize = history.iter().map(|turn| turn.content.chars().count()).sum();
    if total > MAX_TOTAL_CHARS {
        return Err(format!(
            "history must be at most {MAX_TOTAL_CHARS} characters"
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct InterviewContext {
    pub kind: String,
    pub profile: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CoachTurnRequest {
    pub scenario: CoachScenario,
    #[serde(default)]
    pub scenario_id: Option<String>,
    #[serde(default)]
    pub history: Vec<CoachTurn>,
    pub user_text: String,
    /// Number of completed user turns already persisted by the client draft.
    #[serde(default)]
    pub completed_turns: Option<u32>,
    #[serde(default)]
    pub coach_mode: CoachMode,
    #[serde(default)]
    pub locale: Option<String>,
    #[serde(default)]
    pub interview: Option<InterviewContext>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoachCorrection {
    pub original: String,
    pub corrected: String,
    #[serde(default)]
    pub explanation_zh: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoachBetterPhrasing {
    pub original: String,
    pub natural: String,
    #[serde(default)]
    pub note_zh: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoachExpression {
    pub en: String,
    pub zh: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoachFeedback {
    #[serde(default)]
    pub corrections: Vec<CoachCorrection>,
    #[serde(default)]
    pub better_phrasing: Option<CoachBetterPhrasing>,
    #[serde(default)]
    pub expressions: Vec<CoachExpression>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoachTurnResponse {
    pub reply: String,
    /// `reply` 的中文翻译，直接从回复下方展示给学习者（自己说的话不需要翻译）。
    #[serde(default)]
    pub reply_zh: String,
    pub mood: String,
    pub turn_index: u32,
    pub limit_reached: bool,
    #[serde(default)]
    pub feedback: Option<CoachFeedback>,
    /// 「接下来可以怎么说」：针对本轮 `reply` 给出的、学习者可以直接照说的一两句。
    /// 与 `feedback` 分开，因为它是关于下一句而不是对用户上一句的纠正。
    #[serde(default)]
    pub next_lines: Vec<CoachExpression>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CoachSummaryRequest {
    pub scenario: CoachScenario,
    #[serde(default)]
    pub scenario_id: Option<String>,
    #[serde(default)]
    pub history: Vec<CoachTurn>,
    #[serde(default)]
    pub locale: Option<String>,
    #[serde(default)]
    pub interview: Option<InterviewContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoachSummaryStats {
    pub turns: u32,
    pub user_chars: u32,
    pub corrections: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InterviewFeedback {
    pub star_structure: String,
    pub quantified_impact: String,
    #[serde(default)]
    pub weak_spots: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoachSummaryResponse {
    pub overall_zh: String,
    pub overall_en: String,
    pub strengths: Vec<String>,
    pub improvements: Vec<String>,
    pub expressions: Vec<CoachExpression>,
    pub stats: CoachSummaryStats,
    #[serde(default)]
    pub interview_feedback: Option<InterviewFeedback>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct InterviewProfileRequest {
    pub kind: String,
    pub text: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct InterviewProfileResponse {
    pub kind: String,
    pub profile: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CoachScenarioDraftRequest {
    pub description: String,
    #[serde(default)]
    pub locale: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> CoachScenario {
        CoachScenario {
            id: "standup_update".into(),
            source: CoachScenarioSource::Preset,
            category: CoachCategory::Engineering,
            title: "每日站会".into(),
            description: "汇报进度".into(),
            persona: CoachPersona {
                name: "Alex".into(),
                role: "Tech Lead".into(),
                locale: "en-US".into(),
                tone: "friendly".into(),
            },
            setting: "meeting".into(),
            opening_line: "Morning! How's the feature going?".into(),
            opening_line_zh: "早！功能做得怎么样了？".into(),
            opening_next_lines: vec![],
            focus_points: vec!["progress".into(), "blocker".into()],
            difficulty: "core".into(),
            max_turns: 10,
        }
    }

    #[test]
    fn validates_interview_context_shape_and_budget() {
        assert!(validate_interview_context(&InterviewContext {
            kind: "resume".into(),
            profile: "ok".into(),
        })
        .is_ok());
        assert!(validate_interview_context(&InterviewContext {
            kind: "resume_job".into(),
            profile: "ok".into(),
        })
        .is_ok());
        assert!(validate_interview_context(&InterviewContext {
            kind: "raw_resume".into(),
            profile: "ok".into(),
        })
        .is_err());
        assert!(validate_interview_context(&InterviewContext {
            kind: "resume".into(),
            profile: " ".into(),
        })
        .is_err());
        assert!(validate_interview_context(&InterviewContext {
            kind: "resume".into(),
            profile: "字".repeat(MAX_INTERVIEW_PROFILE_CHARS + 1),
        })
        .is_err());
    }

    #[test]
    fn summary_history_has_an_explicit_character_budget() {
        let too_long = vec![CoachTurn {
            role: CoachRole::User,
            content: "x".repeat(MAX_TOTAL_CHARS + 1),
        }];
        assert!(validate_summary_history(&too_long).is_err());
        assert!(validate_summary_history(&[]).is_err());
    }

    #[test]
    fn clamps_max_turns_into_range() {
        let mut s = base();
        s.max_turns = 99;
        assert_eq!(validate_scenario(&s).unwrap().max_turns, 20);
        s.max_turns = 1;
        assert_eq!(validate_scenario(&s).unwrap().max_turns, 3);
    }

    #[test]
    fn rejects_overlong_title() {
        let mut s = base();
        s.title = "x".repeat(61);
        assert!(validate_scenario(&s).is_err());
    }

    #[test]
    fn rejects_unknown_locale() {
        let mut s = base();
        s.persona.locale = "en-XX".into();
        assert!(validate_scenario(&s).is_err());
    }

    #[test]
    fn accepts_zh_cn_locale() {
        let mut s = base();
        s.persona.locale = "zh-CN".into();
        assert!(validate_scenario(&s).is_ok());
    }

    #[test]
    fn rejects_too_many_focus_points() {
        let mut s = base();
        s.focus_points = (0..6).map(|i| format!("point {i}")).collect();
        assert!(validate_scenario(&s).is_err());
    }

    #[test]
    fn rejects_overlong_user_text_and_too_many_history() {
        // spec 只限制 user_text 单条 ≤ 2000，不限制单条 history 的长度
        let empty: Vec<CoachTurn> = vec![];
        assert!(validate_history(&empty, &"a".repeat(2001)).is_err());

        let many = (0..41)
            .map(|i| CoachTurn { role: CoachRole::User, content: format!("t{i}") })
            .collect::<Vec<_>>();
        assert!(validate_history(&many, "hi").is_err());
    }

    #[test]
    fn rejects_history_over_total_char_budget() {
        let long_history = (0..7)
            .map(|_| CoachTurn { role: CoachRole::User, content: "a".repeat(2_000) })
            .collect::<Vec<_>>();
        assert!(validate_history(&long_history, "hello").is_err());
    }
}
