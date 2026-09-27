import type {
  CoachCategory,
  CoachQuotaStatus,
  CoachScenario,
} from './coach-types';

const CATEGORY_ORDER: CoachCategory[] = ['daily', 'engineering', 'high_stakes'];

export interface CoachScenarioGroup {
  category: CoachCategory;
  items: CoachScenario[];
}

export function groupScenarios(scenarios: CoachScenario[]): CoachScenarioGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    items: scenarios.filter((scenario) => scenario.category === category),
  })).filter((group) => group.items.length > 0);
}

export type CoachStartCheck =
  | { ok: true }
  | { ok: false; reason: 'quota' | 'llm' };

export function canStartCoach({
  quota,
}: {
  quota: CoachQuotaStatus;
  scenario: CoachScenario;
}): CoachStartCheck {
  if (!quota.llm_configured) return { ok: false, reason: 'llm' };
  if (quota.enabled && quota.remaining !== null && quota.remaining <= 0) {
    return { ok: false, reason: 'quota' };
  }
  return { ok: true };
}

export function quotaLabel(quota: CoachQuotaStatus): string {
  if (!quota.enabled || quota.limit === 0 || quota.remaining === null) {
    return 'unlimited';
  }
  return `${quota.remaining}/${quota.limit}`;
}
