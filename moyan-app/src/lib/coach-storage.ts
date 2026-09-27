import type {
  CoachHistoryRecord,
  CoachPrefs,
  CoachScenario,
  InterviewProfileRecord,
} from './coach-types';

export interface KeyValueStore {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

const KEYS = {
  scenarios: 'coach_custom_scenarios_v1',
  history: 'coach_history_v1',
  profiles: 'coach_interview_profiles_v1',
  prefs: 'coach_prefs_v1',
} as const;

export const DEFAULT_COACH_PREFS: CoachPrefs = {
  defaultMode: 'feedback',
  accentPreference: 'en-US',
  autoPlay: true,
};

async function readJson<T>(
  store: KeyValueStore,
  key: string,
  fallback: T
): Promise<T> {
  try {
    const raw = await store.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(
  store: KeyValueStore,
  key: string,
  value: T
): Promise<void> {
  await store.setItem(key, JSON.stringify(value));
}

export function createCoachStorage(store: KeyValueStore) {
  return {
    async loadCustomScenarios(): Promise<CoachScenario[]> {
      const value = await readJson<unknown>(store, KEYS.scenarios, []);
      return Array.isArray(value) ? (value as CoachScenario[]) : [];
    },

    async saveCustomScenario(scenario: CoachScenario): Promise<void> {
      const list = await this.loadCustomScenarios();
      const next = list.filter((item) => item.id !== scenario.id);
      next.push({ ...scenario, source: 'custom' });
      await writeJson(store, KEYS.scenarios, next);
    },

    async deleteCustomScenario(id: string): Promise<void> {
      const next = (await this.loadCustomScenarios()).filter((item) => item.id !== id);
      await writeJson(store, KEYS.scenarios, next);
    },

    async loadCoachHistory(): Promise<CoachHistoryRecord[]> {
      const value = await readJson<unknown>(store, KEYS.history, []);
      if (!Array.isArray(value)) return [];
      return (value as CoachHistoryRecord[]).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      );
    },

    async saveCoachHistory(record: CoachHistoryRecord): Promise<void> {
      const list = await this.loadCoachHistory();
      const next = list.filter((item) => item.id !== record.id);
      next.push(record);
      next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      await writeJson(store, KEYS.history, next);
    },

    async deleteCoachHistory(id: string): Promise<void> {
      const next = (await this.loadCoachHistory()).filter((item) => item.id !== id);
      await writeJson(store, KEYS.history, next);
    },

    async clearCoachHistory(): Promise<void> {
      await store.removeItem(KEYS.history);
    },

    async loadInterviewProfiles(): Promise<InterviewProfileRecord[]> {
      const value = await readJson<unknown>(store, KEYS.profiles, []);
      if (!Array.isArray(value)) return [];
      return (value as InterviewProfileRecord[]).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      );
    },

    async saveInterviewProfile(record: InterviewProfileRecord): Promise<void> {
      const list = await this.loadInterviewProfiles();
      const next = list.filter((item) => item.id !== record.id);
      next.push(record);
      next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      await writeJson(store, KEYS.profiles, next);
    },

    async deleteInterviewProfile(id: string): Promise<void> {
      const next = (await this.loadInterviewProfiles()).filter((item) => item.id !== id);
      await writeJson(store, KEYS.profiles, next);
    },

    async loadCoachPrefs(): Promise<CoachPrefs> {
      return {
        ...DEFAULT_COACH_PREFS,
        ...(await readJson<Partial<CoachPrefs>>(store, KEYS.prefs, {})),
      };
    },

    async saveCoachPrefs(prefs: CoachPrefs): Promise<void> {
      await writeJson(store, KEYS.prefs, prefs);
    },
  };
}

async function defaultStore(): Promise<KeyValueStore> {
  const { default: AsyncStorage } = await import(
    '@react-native-async-storage/async-storage'
  );
  return AsyncStorage as unknown as KeyValueStore;
}

async function defaultStorage() {
  return createCoachStorage(await defaultStore());
}

export const loadCustomScenarios = async () =>
  (await defaultStorage()).loadCustomScenarios();
export const saveCustomScenario = async (scenario: CoachScenario) =>
  (await defaultStorage()).saveCustomScenario(scenario);
export const deleteCustomScenario = async (id: string) =>
  (await defaultStorage()).deleteCustomScenario(id);
export const loadCoachHistory = async () =>
  (await defaultStorage()).loadCoachHistory();
export const saveCoachHistory = async (record: CoachHistoryRecord) =>
  (await defaultStorage()).saveCoachHistory(record);
export const deleteCoachHistory = async (id: string) =>
  (await defaultStorage()).deleteCoachHistory(id);
export const clearCoachHistory = async () =>
  (await defaultStorage()).clearCoachHistory();
export const loadInterviewProfiles = async () =>
  (await defaultStorage()).loadInterviewProfiles();
export const saveInterviewProfile = async (record: InterviewProfileRecord) =>
  (await defaultStorage()).saveInterviewProfile(record);
export const deleteInterviewProfile = async (id: string) =>
  (await defaultStorage()).deleteInterviewProfile(id);
export const loadCoachPrefs = async () => (await defaultStorage()).loadCoachPrefs();
export const saveCoachPrefs = async (prefs: CoachPrefs) =>
  (await defaultStorage()).saveCoachPrefs(prefs);
