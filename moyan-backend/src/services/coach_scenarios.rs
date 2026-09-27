//! 预置陪练场景目录（程序员 / 远程工作向）。
//!
//! 中英双语文案存在这里；`list_presets` 按请求 locale 输出单语言字段。
//! `guidance` 只存在于服务端，随 prompt 附加，绝不下发给客户端。

use crate::models::{CoachCategory, CoachPersona, CoachScenario, CoachScenarioSource};

struct Preset {
    id: &'static str,
    category: CoachCategory,
    title_zh: &'static str,
    title_en: &'static str,
    description_zh: &'static str,
    description_en: &'static str,
    name: &'static str,
    role: &'static str,
    locale: &'static str,
    tone: &'static str,
    setting: &'static str,
    opening_line: &'static str,
    focus_zh: &'static [&'static str],
    focus_en: &'static [&'static str],
    difficulty: &'static str,
    max_turns: u32,
    guidance: &'static str,
}

const PRESETS: &[Preset] = &[
    Preset {
        id: "standup_update",
        category: CoachCategory::Engineering,
        title_zh: "每日站会 · 进度同步",
        title_en: "Daily Standup",
        description_zh: "向同事汇报进展、阻塞和下一步",
        description_en: "Report progress, blockers, and next steps",
        name: "Alex",
        role: "Tech Lead",
        locale: "en-US",
        tone: "friendly",
        setting: "meeting",
        opening_line: "Morning! How's the feature going?",
        focus_zh: &["进度说清楚", "主动提阻塞", "明确下一步"],
        focus_en: &["state progress", "raise blockers", "name next step"],
        difficulty: "core",
        max_turns: 10,
        guidance: "保持站会节奏，每个回答 1-2 句即可。如果用户没说下一步，追问一句 \
                   \"What's your plan for today?\"。用户表达过于书面时，示范更口语的说法。",
    },
    Preset {
        id: "code_review",
        category: CoachCategory::Engineering,
        title_zh: "Code Review 讨论",
        title_en: "Code Review Discussion",
        description_zh: "回应评审意见，解释技术理由，该坚持时坚持",
        description_en: "Respond to review comments and defend your reasoning",
        name: "Priya",
        role: "Senior Engineer",
        locale: "en-IN",
        tone: "direct",
        setting: "meeting",
        opening_line: "I left a few comments on your PR. Want to walk through them?",
        focus_zh: &["接受合理意见", "解释取舍", "礼貌坚持"],
        focus_en: &["accept feedback", "explain trade-offs", "push back politely"],
        difficulty: "challenge",
        max_turns: 12,
        guidance: "扮演一位严格但公正的资深工程师，对方案提出具体质疑。用户让步时追问理由；\
                   用户解释清楚时要认可。示范表达：\"I see your point, but I'm worried about…\"。",
    },
    Preset {
        id: "design_discussion",
        category: CoachCategory::Engineering,
        title_zh: "技术方案讨论",
        title_en: "Design Discussion",
        description_zh: "讲清方案取舍，被质疑时稳住节奏",
        description_en: "Explain trade-offs and answer hard questions",
        name: "Daniel",
        role: "Staff Engineer",
        locale: "en-GB",
        tone: "neutral",
        setting: "meeting",
        opening_line: "So, you're proposing we add a queue in front of the writer. Why?",
        focus_zh: &["先给结论", "讲 trade-off", "回答追问"],
        focus_en: &["lead with the answer", "name trade-offs", "handle follow-ups"],
        difficulty: "challenge",
        max_turns: 12,
        guidance: "持续追问设计动机和失败场景，例如 \"What happens if the queue backs up?\"。\
                   用户只给结论不给理由时，追问 \"What's the reasoning behind that?\"。",
    },
    Preset {
        id: "incident_sync",
        category: CoachCategory::HighStakes,
        title_zh: "线上故障同步",
        title_en: "Incident Sync",
        description_zh: "说清影响面、当前进展和 ETA",
        description_en: "Communicate impact, status, and ETA under pressure",
        name: "Sam",
        role: "SRE",
        locale: "en-US",
        tone: "direct",
        setting: "meeting",
        opening_line: "We're getting error spikes in eu-west. What do you know so far?",
        focus_zh: &["先说影响面", "区分已知与未知", "给 ETA 或下次更新"],
        focus_en: &["state impact first", "separate known from unknown", "give an ETA"],
        difficulty: "challenge",
        max_turns: 12,
        guidance: "语速可以偏快、追问频繁，模拟真实故障沟通压力。用户含糊时追问 \
                   \"What's the customer impact?\" 或 \"When will we have an update?\"。",
    },
    Preset {
        id: "scope_deadline",
        category: CoachCategory::HighStakes,
        title_zh: "需求与排期",
        title_en: "Scope and Deadline",
        description_zh: "拒绝不合理 deadline，谈范围和优先级",
        description_en: "Push back on deadlines and negotiate scope",
        name: "Jordan",
        role: "Product Manager",
        locale: "en-US",
        tone: "challenging",
        setting: "one_on_one",
        opening_line: "Can we ship this by Friday? Sales is asking.",
        focus_zh: &["不裸拒", "给替代方案", "把取舍摆到台面"],
        focus_en: &["don't just say no", "offer options", "surface the trade-off"],
        difficulty: "challenge",
        max_turns: 12,
        guidance: "持续施压要求提前交付。逼用户在「砍范围」「延期」「加人」之间做选择，\
                   并追问 \"What would you cut?\"。用户硬扛不合理承诺时要点明风险。",
    },
    Preset {
        id: "ask_for_help",
        category: CoachCategory::Daily,
        title_zh: "向资深同事求助",
        title_en: "Asking for Help",
        description_zh: "说清卡点，带着已尝试方案求助",
        description_en: "Explain a blocker and ask for help clearly",
        name: "Priya",
        role: "Senior Engineer",
        locale: "en-IN",
        tone: "friendly",
        setting: "one_on_one",
        opening_line: "Hey, you look stuck. What's going on?",
        focus_zh: &["描述现象", "列出已尝试", "提出具体请求"],
        focus_en: &["describe the symptom", "list what you tried", "make a specific ask"],
        difficulty: "core",
        max_turns: 10,
        guidance: "友好但有经验。用户只说 \"It doesn't work\" 时追问具体错误和已尝试的方案；\
                   用户说清楚后给出方向并鼓励：\"That's a good debugging step.\"。",
    },
    Preset {
        id: "one_on_one",
        category: CoachCategory::Daily,
        title_zh: "和主管 1:1",
        title_en: "One-on-One",
        description_zh: "聊工作量、反馈和成长诉求",
        description_en: "Discuss workload, feedback, and growth",
        name: "Morgan",
        role: "Engineering Manager",
        locale: "en-AU",
        tone: "friendly",
        setting: "one_on_one",
        opening_line: "How's everything going lately? Anything on your mind?",
        focus_zh: &["表达真实状态", "给具体例子", "提出诉求"],
        focus_en: &["be honest", "give concrete examples", "make a request"],
        difficulty: "core",
        max_turns: 10,
        guidance: "温和地追问细节，例如 \"Can you give me an example?\"。用户抱怨但不提诉求时，\
                   引导他说出具体想要什么（换项目、减负载、要反馈）。",
    },
    Preset {
        id: "remote_small_talk",
        category: CoachCategory::Daily,
        title_zh: "远程茶水间",
        title_en: "Remote Small Talk",
        description_zh: "寒暄、接话，别让话题掉地上",
        description_en: "Keep a casual conversation going",
        name: "Emma",
        role: "Designer",
        locale: "en-GB",
        tone: "friendly",
        setting: "coffee_chat",
        opening_line: "Hey! How's your week going? Surviving the meetings?",
        focus_zh: &["回应加反问", "分享一个小细节", "延续话题"],
        focus_en: &["answer and ask back", "share a detail", "keep it going"],
        difficulty: "easy",
        max_turns: 8,
        guidance: "轻松闲聊，话题围绕远程工作日常、天气、周末、咖啡、宠物。\
                   用户只回一个词时，帮他扩展并抛出下一个话题。",
    },
];

fn localized<'a>(locale: &str, zh: &'a str, en: &'a str) -> String {
    if locale.starts_with("en") { en.to_string() } else { zh.to_string() }
}

fn to_scenario(preset: &Preset, locale: &str) -> CoachScenario {
    CoachScenario {
        id: preset.id.to_string(),
        source: CoachScenarioSource::Preset,
        category: preset.category,
        title: localized(locale, preset.title_zh, preset.title_en),
        description: localized(locale, preset.description_zh, preset.description_en),
        persona: CoachPersona {
            name: preset.name.to_string(),
            role: preset.role.to_string(),
            locale: preset.locale.to_string(),
            tone: preset.tone.to_string(),
        },
        setting: preset.setting.to_string(),
        // 开场白始终为英文：它会被直接朗读给用户
        opening_line: preset.opening_line.to_string(),
        focus_points: if locale.starts_with("en") {
            preset.focus_en.iter().map(|s| s.to_string()).collect()
        } else {
            preset.focus_zh.iter().map(|s| s.to_string()).collect()
        },
        difficulty: preset.difficulty.to_string(),
        max_turns: preset.max_turns,
    }
}

pub fn list_presets(locale: &str) -> Vec<CoachScenario> {
    PRESETS.iter().map(|p| to_scenario(p, locale)).collect()
}

/// 预置场景的服务端教学指引；只用于 prompt，永不下发客户端。
pub fn preset_guidance(scenario_id: &str) -> Option<&'static str> {
    PRESETS.iter().find(|p| p.id == scenario_id).map(|p| p.guidance)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_eight_unique_presets() {
        let list = list_presets("zh-CN");
        assert_eq!(list.len(), 8);
        let mut ids: Vec<_> = list.iter().map(|s| s.id.clone()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 8);
    }

    #[test]
    fn localizes_title_and_description() {
        let zh = list_presets("zh-CN");
        let en = list_presets("en");
        let zh_standup = zh.iter().find(|s| s.id == "standup_update").unwrap();
        let en_standup = en.iter().find(|s| s.id == "standup_update").unwrap();
        assert_ne!(zh_standup.title, en_standup.title);
        assert_eq!(en_standup.title, "Daily Standup");
        // 开场白始终是英文，供 AI 直接朗读
        assert_eq!(zh_standup.opening_line, en_standup.opening_line);
    }

    #[test]
    fn every_preset_passes_validation() {
        for s in list_presets("zh-CN") {
            assert!(crate::models::validate_scenario(&s).is_ok(), "{} invalid", s.id);
        }
    }

    #[test]
    fn guidance_covers_every_preset() {
        for s in list_presets("zh-CN") {
            assert!(preset_guidance(&s.id).is_some(), "{} missing guidance", s.id);
        }
        assert!(preset_guidance("nope").is_none());
    }
}
