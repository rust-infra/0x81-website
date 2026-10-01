//! 预置陪练场景目录（程序员 / 远程工作向）。
//!
//! 中英双语文案存在这里；`list_presets` 按请求 locale 输出单语言字段。
//! `guidance` 只存在于服务端，随 prompt 附加，绝不下发给客户端。

use crate::models::{CoachCategory, CoachExpression, CoachPersona, CoachScenario, CoachScenarioSource};

struct Opening {
    en: &'static str,
    zh: &'static str,
    suggestions: &'static [(&'static str, &'static str)],
}

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
    /// 开场白变体池。每条开场白自带贴题的推荐表达，随机切换时不会答非所问。
    openings: &'static [Opening],
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
        openings: &[
            Opening {
                en: "Morning! How's the feature going?",
                zh: "早！功能做得怎么样了？",
                suggestions: &[("The feature is on track, and I'm finishing the main flow.", "功能进展顺利，我正在完成主流程。"), ("I wrapped up the API work and will tackle the UI today.", "我完成了 API 部分，今天会处理 UI。")],
            },
            Opening {
                en: "Hey, quick one — where are we on the feature?",
                zh: "嘿，快速同步一下——那个功能到什么程度了？",
                suggestions: &[("We're on track; the API is done and the UI is in progress.", "进展顺利，API 已经完成，UI 还在做。"), ("The main flow is working, and I'm checking edge cases now.", "主流程已经跑通，我现在在检查边界情况。")],
            },
            Opening {
                en: "Morning! Ready for standup? How's your work going?",
                zh: "早！准备站会了吗？你那边进展如何？",
                suggestions: &[("I'm ready. Here's my progress and what I'll do next.", "我准备好了。下面是我的进展和下一步。"), ("I finished the API work and today I'll focus on the UI.", "我完成了 API，今天会集中做 UI。")],
            },
        ],
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
        openings: &[
            Opening {
                en: "I left a few comments on your PR. Want to walk through them?",
                zh: "我在你的 PR 上留了几条评论，要不要一起过一下？",
                suggestions: &[("Sure, let's start with the key changes.", "好，我们先从关键改动开始。"), ("Which comment should we start with?", "我们先从哪条评论开始？")],
            },
            Opening {
                en: "I went through your PR last night. Got a couple of questions.",
                zh: "我昨晚看了你的 PR，有几个问题想问你。",
                suggestions: &[("Sure, what's your first question?", "好，你的第一个问题是什么？"), ("I can walk you through the design and the trade-offs.", "我可以给你讲讲设计取舍。")],
            },
            Opening {
                en: "Your PR is open — let's talk through the comments I left.",
                zh: "你的 PR 开着呢，说说我留的那几条评论吧。",
                suggestions: &[("Okay, which comment is the most important?", "好，哪条评论最重要？"), ("Let's go through the edge-case comment first.", "我们先看那条关于边界情况的评论。")],
            },
        ],
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
        openings: &[
            Opening {
                en: "So, you're proposing we add a queue in front of the writer. Why?",
                zh: "也就是说，你提议在写入前面加一个队列。为什么？",
                suggestions: &[("The queue protects the writer from traffic spikes.", "队列可以保护写入服务，避免流量突增把它压垮。"), ("Without it, bursts can overwhelm the writer and drop requests.", "没有它的话，流量峰值可能会压垮写入服务并丢请求。")],
            },
            Opening {
                en: "Walk me through the design doc — what problem does it solve?",
                zh: "讲讲你的设计文档——它解决什么问题？",
                suggestions: &[("It solves duplicate writes during retries.", "它解决的是重试时的重复写入问题。"), ("The design keeps writes idempotent under failures.", "这个设计让写入在故障下保持幂等。")],
            },
            Opening {
                en: "I read your proposal. What's the failure mode you're most worried about?",
                zh: "我看了你的方案。你最担心的失败场景是什么？",
                suggestions: &[("My biggest concern is message loss during failover.", "我最担心的是故障切换时消息丢失。"), ("I would add retries and a dead-letter queue for safety.", "为了安全，我会加重试和死信队列。")],
            },
        ],
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
        openings: &[
            Opening {
                en: "We're getting error spikes in eu-west. What do you know so far?",
                zh: "eu-west 这边错误在飙升。你目前了解到什么？",
                suggestions: &[("We're seeing 500s in eu-west after the last deploy.", "上次发布后，eu-west 开始出现 500 错误。"), ("Impact is limited to checkout requests so far.", "目前影响范围只涉及结账请求。")],
            },
            Opening {
                en: "Status check — eu-west is degrading. Give me what you have.",
                zh: "报一下状态——eu-west 在恶化，把你手上的信息给我。",
                suggestions: &[("The error rate is still climbing; rollback is in progress.", "错误率还在升高，回滚正在进行。"), ("I'll confirm customer impact and share an update in five minutes.", "我会确认客户影响，五分钟后同步。")],
            },
            Opening {
                en: "How bad is it? Customers are asking about the eu-west errors.",
                zh: "有多严重？客户在问 eu-west 的错误。",
                suggestions: &[("About 2% of requests are failing; core checkout is affected.", "大约 2% 的请求失败，核心结账流程受影响。"), ("No data loss so far, and we're rolling back the change.", "目前没有数据丢失，我们正在回滚这次变更。")],
            },
        ],
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
        openings: &[
            Opening {
                en: "Can we ship this by Friday? Sales is asking.",
                zh: "这个周五能上线吗？销售那边在催。",
                suggestions: &[("We can ship the core flow by Friday if we defer the dashboard.", "如果把仪表盘延期，核心流程可以在周五交付。"), ("To hit Friday, we'd need to cut scope or add another engineer.", "要赶上周五，就需要缩小范围或增加一位工程师。")],
            },
            Opening {
                en: "Sales wants this by Friday. Can you make it?",
                zh: "销售想周五要这个。你能做出来吗？",
                suggestions: &[("It's possible only if we cut the reporting flow.", "只有砍掉报表流程才有可能。"), ("Friday is risky unless we add another engineer.", "除非再增加一位工程师，否则周五风险很大。")],
            },
            Opening {
                en: "We need a date. What can you realistically ship next week?",
                zh: "我们得给个日期。下周你现实上能交付什么？",
                suggestions: &[("Next week we can realistically ship the core flow.", "下周我们现实上可以交付核心流程。"), ("The dashboard still needs another sprint.", "仪表盘还需要一个迭代。")],
            },
        ],
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
        openings: &[
            Opening {
                en: "Hey, you look stuck. What's going on?",
                zh: "嘿，你看起来卡住了。怎么了？",
                suggestions: &[("I'm stuck on a 401 after the token refresh.", "token 刷新后我一直卡在 401。"), ("I checked the logs and tried a new token, but it still fails.", "我查了日志也换了新 token，但还是失败。")],
            },
            Opening {
                en: "You've been quiet today. Anything I can help with?",
                zh: "你今天挺安静的。有什么我能帮上的？",
                suggestions: &[("I'm debugging an auth issue and could use a second opinion.", "我在排查认证问题，想听听你的意见。"), ("Could you help me check whether the token scope is correct?", "你能帮我确认一下 token 权限范围吗？")],
            },
            Opening {
                en: "Hey — need a second pair of eyes on something?",
                zh: "嘿——需要我帮你看点什么吗？",
                suggestions: &[("Yes, the retry logic isn't behaving as expected.", "是的，重试逻辑的表现不符合预期。"), ("Could you look at the request flow with me?", "你能和我一起看一下请求流程吗？")],
            },
        ],
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
        openings: &[
            Opening {
                en: "How's everything going lately? Anything on your mind?",
                zh: "最近一切都还好吗？有什么心事？",
                suggestions: &[("I'd like to talk about my workload.", "我想聊聊我的工作量。"), ("I want feedback on what to focus on next.", "我想听听你对下一步重点的建议。")],
            },
            Opening {
                en: "So, how are you doing? Anything you want to talk through?",
                zh: "怎么样，最近还好吗？有什么想聊的？",
                suggestions: &[("I've been feeling stretched since the migration.", "接手迁移之后我一直有点吃不消。"), ("Could we talk about how to rebalance my priorities?", "我们能聊聊怎么重新平衡优先级吗？")],
            },
            Opening {
                en: "Let's start with you. How's the workload feeling these days?",
                zh: "从你开始吧。最近工作量感觉怎么样？",
                suggestions: &[("The workload has been heavy since we took on the migration.", "接手迁移之后，工作量一直比较大。"), ("I'd like to rebalance one of my projects.", "我想调整一下其中一个项目的投入。")],
            },
        ],
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
        openings: &[
            Opening {
                en: "Hey! How's your week going? Surviving the meetings?",
                zh: "嘿！这周过得怎么样？会议还扛得住吗？",
                suggestions: &[("It's been a busy week, but the design review went well.", "这周挺忙的，不过设计评审进展不错。"), ("I'm surviving, mostly one meeting at a time.", "还撑得住，基本上是一场会接一场会。")],
            },
            Opening {
                en: "Morning! Any plans for the weekend?",
                zh: "早！周末有什么安排吗？",
                suggestions: &[("I'm planning a quiet weekend with family.", "我打算和家人过一个安静的周末。"), ("No big plans yet—what about you?", "还没什么大计划，你呢？")],
            },
            Opening {
                en: "Hey, how's it going? Still working from the same café?",
                zh: "嘿，最近咋样？还在同一家咖啡店办公吗？",
                suggestions: &[("Still working from the same café, but I like the routine.", "还在同一家咖啡店办公，不过我喜欢这种节奏。"), ("I switch cafés depending on the weather.", "我会根据天气换不同的咖啡店。")],
            },
        ],
        focus_zh: &["回应加反问", "分享一个小细节", "延续话题"],
        focus_en: &["answer and ask back", "share a detail", "keep it going"],
        difficulty: "easy",
        max_turns: 8,
        guidance: "轻松闲聊，话题围绕远程工作日常、天气、周末、咖啡、宠物。\
                   用户只回一个词时，帮他扩展并抛出下一个话题。",
    },
    Preset {
        id: "interview_screening",
        category: CoachCategory::HighStakes,
        title_zh: "HR 初筛",
        title_en: "HR Screening",
        description_zh: "用英文讲清经历、动机与岗位匹配度",
        description_en: "Explain your background, motivation, and fit",
        name: "Rachel",
        role: "Recruiter",
        locale: "en-US",
        tone: "friendly",
        setting: "phone_call",
        openings: &[
            Opening {
                en: "Thanks for making the time. Tell me a bit about yourself.",
                zh: "谢谢你抽时间。先简单介绍一下你自己吧。",
                suggestions: &[("I've been building backend services for five years, mostly in Rust.", "我做后端开发五年了，主要使用 Rust。"), ("Recently, I led a migration that reduced our API latency by 30%.", "最近我负责了一次迁移，让 API 延迟降低了 30%。")],
            },
            Opening {
                en: "Thanks for hopping on the call. Could you walk me through your background?",
                zh: "谢谢你上线。能简单讲讲你的经历吗？",
                suggestions: &[("I started in payments and moved into platform engineering.", "我从支付业务起步，后来转到了平台工程。"), ("For the last five years I've focused on backend services.", "过去五年我一直专注后端服务。")],
            },
            Opening {
                en: "Great to meet you. Why don't you start with a quick intro?",
                zh: "很高兴认识你。你先简单介绍一下自己吧？",
                suggestions: &[("Sure, I'm a backend engineer with five years of experience.", "好，我是一名有五年经验的后端工程师。"), ("I currently lead a small team building internal platforms.", "我目前在带一个小团队做内部平台。")],
            },
        ],
        focus_zh: &["经历主线", "求职动机", "岗位匹配"],
        focus_en: &["career story", "motivation", "role fit"],
        difficulty: "core",
        max_turns: 12,
        guidance: "扮演 HR 初筛面试官。关注用户能否用 60-90 秒讲清经历主线、为什么这个岗位、\
                   为什么这家公司；回答空泛时追问 \"What specifically attracted you to this role?\"。",
    },
    Preset {
        id: "interview_behavioral",
        category: CoachCategory::HighStakes,
        title_zh: "行为面 · STAR",
        title_en: "Behavioural Interview",
        description_zh: "用 STAR 结构回答冲突、失败与影响力问题",
        description_en: "Answer conflict, failure, and impact questions with STAR",
        name: "Marcus",
        role: "Hiring Manager",
        locale: "en-GB",
        tone: "direct",
        setting: "one_on_one",
        openings: &[
            Opening {
                en: "Let's start with a time you disagreed with a teammate. What happened?",
                zh: "我们从一次你和同事意见不合说起吧。当时发生了什么？",
                suggestions: &[("I disagreed because the proposed cache could serve stale permissions.", "我当时提出异议，是因为这个缓存方案可能返回过期权限。"), ("I brought usage data, and we agreed to test a safer alternative.", "我拿出了使用数据，最后我们同意测试更安全的方案。")],
            },
            Opening {
                en: "Tell me about a project that went badly. What did you do?",
                zh: "讲一个做失败的项目。你当时怎么处理的？",
                suggestions: &[("The launch failed because we skipped a migration test.", "上线失败是因为我们跳过了迁移测试。"), ("I owned the postmortem and added a rollback check.", "我负责了复盘，并补上了回滚检查。")],
            },
            Opening {
                en: "I'd like an example of when you changed someone's mind. Walk me through it.",
                zh: "我想听一个你说服别人的例子。详细讲讲。",
                suggestions: &[("I changed their mind by showing the impact on support tickets.", "我通过展示它对客服工单的影响说服了对方。"), ("We tested both options and let the data settle the debate.", "我们测试了两个方案，用数据来解决分歧。")],
            },
        ],
        focus_zh: &["情境与任务", "个人行动", "量化结果"],
        focus_en: &["situation and task", "personal action", "quantified result"],
        difficulty: "challenge",
        max_turns: 12,
        guidance: "严格按 STAR 深挖行为证据。追问用户本人做了什么、结果如何量化；\
                   如果故事没有冲突或取舍，追问 \"What was the hardest trade-off?\"。",
    },
    Preset {
        id: "interview_technical",
        category: CoachCategory::HighStakes,
        title_zh: "技术深挖",
        title_en: "Technical Deep Dive",
        description_zh: "讲架构取舍、故障场景与可扩展性",
        description_en: "Explain architecture trade-offs, failure modes, and scale",
        name: "Priya",
        role: "Staff Engineer",
        locale: "en-IN",
        tone: "neutral",
        setting: "meeting",
        openings: &[
            Opening {
                en: "Pick a project you're proud of and walk me through the architecture.",
                zh: "挑一个你引以为豪的项目，讲讲它的架构。",
                suggestions: &[("I designed the service around clear API and worker boundaries.", "我围绕清晰的 API 和 worker 边界设计了这个服务。"), ("The biggest trade-off was consistency versus write throughput.", "最大的取舍是在一致性和写入吞吐之间平衡。")],
            },
            Opening {
                en: "Let's dig into the last system you designed. Where did you draw the boundaries?",
                zh: "我们深入聊聊你最近设计的系统。边界是怎么划的？",
                suggestions: &[("I separated synchronous APIs from asynchronous workers.", "我把同步 API 和异步 worker 分开了。"), ("That kept latency low and isolated failures.", "这样既保持了低延迟，也隔离了故障。")],
            },
            Opening {
                en: "Tell me about a system you've scaled. What broke first?",
                zh: "讲讲你做过扩展的系统。最先出问题的是什么？",
                suggestions: &[("The database ran out of write capacity first.", "最先撑不住的是数据库写入能力。"), ("We added partitioning and moved hot writes to a queue.", "我们加了分区，并把热点写入移到了队列。")],
            },
        ],
        focus_zh: &["架构边界", "关键取舍", "失败场景"],
        focus_en: &["architecture boundaries", "key trade-offs", "failure modes"],
        difficulty: "challenge",
        max_turns: 12,
        guidance: "扮演 Staff Engineer 做技术深挖。沿着数据流、容量、延迟、一致性和失败恢复追问；\
                   对自称主导的部分追问具体决策与替代方案。",
    },
];

fn localized<'a>(locale: &str, zh: &'a str, en: &'a str) -> String {
    if locale.starts_with("en") { en.to_string() } else { zh.to_string() }
}

/// 从开场白池里挑一个变体。
///
/// 不引入 `rand` 依赖：`RandomState` 的键在每个实例随机，
/// 再叠上纳秒时间与递增计数器，保证同一纳秒内的连续请求也不会撞在一起。
/// 这里只要"看起来每次不一样"，不需要密码学强度。
fn pick_opening(len: usize) -> usize {
    use std::hash::{BuildHasher, Hasher};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    if len <= 1 {
        return 0;
    }

    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);

    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u64(nanos ^ seq.wrapping_mul(0x9E37_79B9_7F4A_7C15));
    (hasher.finish() % len as u64) as usize
}

fn to_scenario(preset: &Preset, locale: &str) -> CoachScenario {
    // 同一个请求里英文与中文必须来自同一个变体，否则会出现"英文问 A、中文对照写 B"
    let opening = &preset.openings
        [pick_opening(preset.openings.len()).min(preset.openings.len().saturating_sub(1))];

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
        opening_line: opening.en.to_string(),
        // 展示用的中文对照；朗读仍然只用上面的英文
        opening_line_zh: opening.zh.to_string(),
        // 场景加载即可展示的首轮推荐表达：直接由预置数据下发，
        // 不必等待第一轮 AI 响应（第一句下面立刻有"可以怎么说"）。
        opening_next_lines: opening
            .suggestions
            .iter()
            .map(|(en, zh)| CoachExpression {
                en: en.to_string(),
                zh: zh.to_string(),
            })
            .collect(),
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
    fn exposes_eleven_unique_presets() {
        let list = list_presets("zh-CN");
        assert_eq!(list.len(), 11);
        let mut ids: Vec<_> = list.iter().map(|s| s.id.clone()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 11);
    }

    #[test]
    fn includes_three_interview_presets() {
        let ids: Vec<_> = list_presets("zh-CN")
            .iter()
            .map(|s| s.id.clone())
            .collect();
        for id in [
            "interview_screening",
            "interview_behavioral",
            "interview_technical",
        ] {
            assert!(ids.contains(&id.to_string()), "{id} missing");
        }
        assert_eq!(ids.len(), 11);
    }

    #[test]
    fn localizes_title_and_description() {
        let zh = list_presets("zh-CN");
        let en = list_presets("en");
        let zh_standup = zh.iter().find(|s| s.id == "standup_update").unwrap();
        let en_standup = en.iter().find(|s| s.id == "standup_update").unwrap();
        assert_ne!(zh_standup.title, en_standup.title);
        assert_eq!(en_standup.title, "Daily Standup");
        // 开场白始终是英文（会被直接朗读），中文对照是展示用的、与 locale 无关
        for s in [zh_standup, en_standup] {
            assert!(
                s.opening_line.chars().any(|ch| ch.is_ascii_alphabetic()),
                "{} 开场白不是英文: {}",
                s.id,
                s.opening_line
            );
            assert!(
                !s.opening_line
                    .chars()
                    .any(|ch| ('\u{4e00}'..='\u{9fff}').contains(&ch)),
                "{} 开场白混入了中文: {}",
                s.id,
                s.opening_line
            );
        }
        for s in &zh {
            assert!(!s.opening_line_zh.is_empty(), "{} 缺开场白中文", s.id);
        }
    }

    /// 开场白要"多变体 + 每次随机挑"，而且每一条变体都必须自带贴题的推荐表达。
    #[test]
    fn openings_vary_and_stay_paired() {
        for preset in PRESETS {
            assert!(preset.openings.len() >= 3, "{} 开场白变体不足 3 个", preset.id);
            for opening in preset.openings {
                assert!(!opening.en.trim().is_empty(), "{} 开场白英文为空", preset.id);
                assert!(!opening.zh.trim().is_empty(), "{} 开场白中文为空", preset.id);
                assert!(
                    !opening.suggestions.is_empty(),
                    "{} 的开场白缺配套推荐: {}",
                    preset.id,
                    opening.en
                );
                for (en, zh) in opening.suggestions {
                    assert!(!en.trim().is_empty(), "{} 推荐表达英文为空", preset.id);
                    assert!(!zh.trim().is_empty(), "{} 推荐表达中文为空", preset.id);
                }
            }
        }

        // 挑出来的中英必须来自同一个变体（不能英文问 A、中文对照写 B）
        for s in list_presets("zh-CN") {
            let preset = PRESETS.iter().find(|p| p.id == s.id).unwrap();
            let paired = preset
                .openings
                .iter()
                .any(|opening| opening.en == s.opening_line && opening.zh == s.opening_line_zh);
            assert!(
                paired,
                "{} 开场白中英不匹配: {} / {}",
                s.id, s.opening_line, s.opening_line_zh
            );
        }

        // 同一个场景反复取，应该出现不止一种开场
        let mut seen = std::collections::HashSet::new();
        for _ in 0..60 {
            let list = list_presets("zh-CN");
            let standup = list.iter().find(|s| s.id == "standup_update").unwrap();
            seen.insert(standup.opening_line.clone());
        }
        assert!(seen.len() > 1, "开场白没有变化，随机挑选失效");
    }

    /// 首轮推荐表达必须来自当前随机选中的那条开场白。
    #[test]
    fn every_preset_has_paired_opening_next_lines() {
        for preset in PRESETS {
            assert!(preset.openings.iter().all(|opening| !opening.suggestions.is_empty()));
        }

        for s in list_presets("zh-CN") {
            assert!(
                !s.opening_next_lines.is_empty(),
                "{} opening_next_lines 为空",
                s.id
            );
            let preset = PRESETS.iter().find(|p| p.id == s.id).unwrap();
            let opening = preset
                .openings
                .iter()
                .find(|opening| opening.en == s.opening_line)
                .unwrap();
            for line in &s.opening_next_lines {
                assert!(!line.en.trim().is_empty(), "{} 推荐表达英文为空", s.id);
                assert!(!line.zh.trim().is_empty(), "{} 推荐表达中文为空", s.id);
                let paired = opening
                    .suggestions
                    .iter()
                    .any(|(en, zh)| *en == line.en && *zh == line.zh);
                assert!(
                    paired,
                    "{} 首轮推荐中英不匹配: {} / {}",
                    s.id, line.en, line.zh
                );
            }
        }
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
