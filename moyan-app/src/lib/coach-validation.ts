import type {
  CoachCategory,
  CoachDifficulty,
  CoachLocale,
  CoachScenario,
  CoachSetting,
  CoachTone,
} from './coach-types';

export interface CoachScenarioErrors {
  title?: string;
  description?: string;
  name?: string;
  role?: string;
  opening_line?: string;
  focus_points?: string;
  category?: string;
  locale?: string;
  tone?: string;
  setting?: string;
  difficulty?: string;
}

const CATEGORIES: CoachCategory[] = ['daily', 'engineering', 'high_stakes'];
const LOCALES: CoachLocale[] = ['en-US', 'en-GB', 'en-IN', 'en-AU', 'zh-CN'];
const TONES: CoachTone[] = ['friendly', 'neutral', 'direct', 'challenging'];
const SETTINGS: CoachSetting[] = ['meeting', 'one_on_one', 'coffee_chat', 'phone_call'];
const DIFFICULTIES: CoachDifficulty[] = ['easy', 'core', 'challenge'];

function tooLong(value: string, max: number): boolean {
  return value.length > max;
}

export function normalizeCoachScenario(
  input: CoachScenario
): { ok: true; scenario: CoachScenario } | { ok: false; errors: CoachScenarioErrors } {
  const errors: CoachScenarioErrors = {};
  if (!input.title.trim() || tooLong(input.title, 60)) errors.title = 'title';
  if (!input.description.trim() || tooLong(input.description, 200)) errors.description = 'description';
  if (!input.persona.name.trim() || tooLong(input.persona.name, 30)) errors.name = 'name';
  if (!input.persona.role.trim() || tooLong(input.persona.role, 60)) errors.role = 'role';
  if (!input.opening_line.trim() || tooLong(input.opening_line, 200)) errors.opening_line = 'opening_line';
  if (input.focus_points.length > 5 || input.focus_points.some((point) => point.length > 40)) {
    errors.focus_points = 'focus_points';
  }
  if (!CATEGORIES.includes(input.category)) errors.category = 'category';
  if (!LOCALES.includes(input.persona.locale)) errors.locale = 'locale';
  if (!TONES.includes(input.persona.tone)) errors.tone = 'tone';
  if (!SETTINGS.includes(input.setting)) errors.setting = 'setting';
  if (!DIFFICULTIES.includes(input.difficulty)) errors.difficulty = 'difficulty';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    scenario: {
      ...input,
      source: 'custom',
      max_turns: Math.max(3, Math.min(20, input.max_turns)),
    },
  };
}

export function scenarioFromTemplate(
  id: string,
  lang: 'zh-CN' | 'en' = 'zh-CN'
): CoachScenario | null {
  const source = lang === 'en' ? TEMPLATES_EN : TEMPLATES;
  const preset = source.find((template) => template.id === id);
  return preset
    ? {
        ...preset,
        persona: { ...preset.persona },
        focus_points: [...preset.focus_points],
      }
    : null;
}

export const TEMPLATES: CoachScenario[] = [
  {
    id: 'incident_sync',
    source: 'custom',
    category: 'high_stakes',
    title: '线上故障同步',
    description: '向上级和美国同事同步影响、进展与下一步',
    persona: { name: 'Sam', role: 'SRE', locale: 'en-US', tone: 'direct' },
    setting: 'meeting',
    opening_line: 'What do you know about the incident so far?',
    focus_points: ['先说影响', '区分已知未知', '给出更新节奏'],
    difficulty: 'challenge',
    max_turns: 12,
  },
  {
    id: 'scope_deadline',
    source: 'custom',
    category: 'high_stakes',
    title: '需求与排期',
    description: '谈范围、优先级和不合理的 deadline',
    persona: { name: 'Jordan', role: 'Product Manager', locale: 'en-US', tone: 'neutral' },
    setting: 'meeting',
    opening_line: 'Can we commit to this date?',
    focus_points: ['说明取舍', '提出选项', '确认优先级'],
    difficulty: 'challenge',
    max_turns: 12,
  },
  {
    id: 'cross_timezone_handoff',
    source: 'custom',
    category: 'engineering',
    title: '跨时区交接',
    description: '把背景、当前状态和下一步交接给不同时区的同事',
    persona: { name: 'Emma', role: 'Teammate', locale: 'en-AU', tone: 'friendly' },
    setting: 'meeting',
    opening_line: 'Hey, can you give me the handoff?',
    focus_points: ['先给背景', '说清当前状态', '留下明确问题'],
    difficulty: 'core',
    max_turns: 10,
  },
  {
    id: 'growth_1on1',
    source: 'custom',
    category: 'daily',
    title: '主管 1:1 · 成长诉求',
    description: '和主管谈 workload、反馈和发展机会',
    persona: { name: 'Morgan', role: 'Engineering Manager', locale: 'en-GB', tone: 'friendly' },
    setting: 'one_on_one',
    opening_line: 'How are things going lately?',
    focus_points: ['表达现状', '给具体例子', '提出诉求'],
    difficulty: 'core',
    max_turns: 10,
  },
];


export const TEMPLATES_EN: CoachScenario[] = [
  {
    id: 'incident_sync',
    source: 'custom',
    category: 'high_stakes',
    title: 'Incident Update',
    description: 'Brief leadership and US teammates on impact, progress and next steps',
    persona: { name: 'Sam', role: 'SRE', locale: 'en-US', tone: 'direct' },
    setting: 'meeting',
    opening_line: 'What do you know about the incident so far?',
    focus_points: ['Lead with impact', 'Separate knowns and unknowns', 'Set an update cadence'],
    difficulty: 'challenge',
    max_turns: 12,
  },
  {
    id: 'scope_deadline',
    source: 'custom',
    category: 'high_stakes',
    title: 'Scope & Deadline',
    description: 'Discuss scope, priority and an unrealistic deadline',
    persona: { name: 'Jordan', role: 'Product Manager', locale: 'en-US', tone: 'neutral' },
    setting: 'meeting',
    opening_line: 'Can we commit to this date?',
    focus_points: ['Explain trade-offs', 'Offer options', 'Confirm priority'],
    difficulty: 'challenge',
    max_turns: 12,
  },
  {
    id: 'cross_timezone_handoff',
    source: 'custom',
    category: 'engineering',
    title: 'Cross-timezone Handoff',
    description: 'Hand off context, current state and next steps across time zones',
    persona: { name: 'Emma', role: 'Teammate', locale: 'en-AU', tone: 'friendly' },
    setting: 'meeting',
    opening_line: 'Hey, can you give me the handoff?',
    focus_points: ['Give context first', 'State the current status', 'Leave a clear question'],
    difficulty: 'core',
    max_turns: 10,
  },
  {
    id: 'growth_1on1',
    source: 'custom',
    category: 'daily',
    title: 'Manager 1:1 · Growth',
    description: 'Discuss workload, feedback and growth with your manager',
    persona: { name: 'Morgan', role: 'Engineering Manager', locale: 'en-GB', tone: 'friendly' },
    setting: 'one_on_one',
    opening_line: 'How are things going lately?',
    focus_points: ['Describe the current state', 'Give a concrete example', 'Make a clear request'],
    difficulty: 'core',
    max_turns: 10,
  },
];
