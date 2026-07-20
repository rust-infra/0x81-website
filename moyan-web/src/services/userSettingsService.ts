import { getCurrentUser, onAuthChange } from "./authService";
import {
  getSpeechSettings,
  saveSpeechSettings,
  type SpeechSettings,
} from "./speechService";
import { getLanguage, setLanguage, type Language } from "@/i18n/translations";
import { getThemeName, setTheme, type ThemeName } from "@/theme";

const API_BASE = import.meta.env.VITE_API_URL || "";
let startupSyncPromise: Promise<void> | null = null;
let startupSyncKey: string | null = null;
let settingsSyncSubscriberCount = 0;
let settingsSyncCleanup: (() => void) | null = null;
let settingsSyncSaveTimer: number | null = null;
let settingsSyncIsApplyingRemote = false;
let settingsSyncSuppressedSaveSignature: string | null = null;
let settingsSyncSkipNextScheduledSave = false;
let settingsSyncSkippedInitialAuthEcho = false;

export interface UserSettingsPayload {
  theme?: string | null;
  language?: string | null;
  speech_provider?: string | null;
  speech_voice?: string | null;
  speech_zh_voice?: string | null;
  speech_model?: string | null;
  speech_speed?: number | null;
  auto_play?: boolean | null;
}

export type SettingsSyncPhase = "fetch" | "save";
export type SettingsSyncStatus = "idle" | "loading" | "saving" | "success" | "error";

export interface SettingsSyncState {
  phase: SettingsSyncPhase;
  status: SettingsSyncStatus;
  message?: string;
  timestamp: number;
}

const SETTINGS_SYNC_EVENT = "moyan:settings-sync-state";
let latestSettingsSyncState: SettingsSyncState | null = null;
let latestSettingsSavedTimestamp: number | null = null;

function getToken(): string | null {
  return localStorage.getItem("moyan_token");
}

function serializeSettingsPayload(settings: UserSettingsPayload): string {
  return JSON.stringify({
    theme: settings.theme ?? null,
    language: settings.language ?? null,
    speech_provider: settings.speech_provider ?? null,
    speech_voice: settings.speech_voice ?? null,
    speech_zh_voice: settings.speech_zh_voice ?? null,
    speech_model: settings.speech_model ?? null,
    speech_speed: settings.speech_speed ?? null,
    auto_play: settings.auto_play ?? null,
  });
}

function emitSettingsSyncState(state: Omit<SettingsSyncState, "timestamp">) {
  latestSettingsSyncState = {
    ...state,
    timestamp: Date.now(),
  };
  window.dispatchEvent(
    new CustomEvent<SettingsSyncState>(SETTINGS_SYNC_EVENT, {
      detail: latestSettingsSyncState,
    })
  );
}

export function getSettingsSyncEventName() {
  return SETTINGS_SYNC_EVENT;
}

export function getLatestSettingsSyncState(): SettingsSyncState | null {
  return latestSettingsSyncState;
}

export function getLatestSettingsSavedTimestamp(): number | null {
  return latestSettingsSavedTimestamp;
}

export function formatSettingsSyncTimestamp(
  timestamp: number,
  language: Language
): string {
  return new Intl.DateTimeFormat(language === "zh-CN" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

export function hasSettingsBackend(): boolean {
  return API_BASE.length > 0;
}

export function buildUserSettingsPayload(): UserSettingsPayload {
  const speech = getSpeechSettings();

  return {
    theme: getThemeName(),
    language: getLanguage(),
    speech_provider: speech.provider,
    speech_voice: getPrimarySpeechVoice(speech),
    speech_zh_voice: getChineseSpeechVoice(speech),
    speech_model: getSpeechModel(speech),
    speech_speed: speech.rate,
    auto_play: speech.autoPlay,
  };
}

export function hasRemoteSettingsValue(settings: UserSettingsPayload): boolean {
  return Object.values(settings).some(
    (value) => value !== null && value !== undefined
  );
}

export function applyUserSettings(settings: UserSettingsPayload): void {
  if (settings.theme) {
    setTheme(settings.theme as ThemeName);
  }

  if (settings.language) {
    setLanguage(settings.language as Language);
  }

  const current = getSpeechSettings();
  const next: SpeechSettings = {
    ...current,
    provider: (settings.speech_provider as SpeechSettings["provider"]) || current.provider,
    rate: settings.speech_speed ?? current.rate,
    autoPlay: settings.auto_play ?? current.autoPlay,
  };

  if (settings.speech_voice) {
    applyPrimarySpeechVoice(next, settings.speech_voice);
  }

  if (settings.speech_zh_voice) {
    next.googleZhVoice = settings.speech_zh_voice;
  }

  if (settings.speech_model) {
    applySpeechModel(next, settings.speech_model);
  }

  saveSpeechSettings(next);
}

export async function fetchUserSettings(): Promise<UserSettingsPayload | null> {
  const token = getToken();
  if (!token || !hasSettingsBackend()) {
    return null;
  }

  emitSettingsSyncState({
    phase: "fetch",
    status: "loading",
    message: "Loading settings",
  });

  const res = await fetch(`${API_BASE}/api/settings`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    emitSettingsSyncState({
      phase: "fetch",
      status: "error",
      message: "加载设置失败",
    });
    throw new Error("加载设置失败");
  }

  const result = await res.json();
  emitSettingsSyncState({
    phase: "fetch",
    status: "success",
    message: "设置已加载",
  });
  return result.data as UserSettingsPayload;
}

export async function saveUserSettings(
  settings: UserSettingsPayload = buildUserSettingsPayload()
): Promise<UserSettingsPayload | null> {
  const token = getToken();
  if (!token || !hasSettingsBackend()) {
    return null;
  }

  emitSettingsSyncState({
    phase: "save",
    status: "saving",
    message: "正在同步设置",
  });

  const res = await fetch(`${API_BASE}/api/settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ settings }),
  });

  if (!res.ok) {
    emitSettingsSyncState({
      phase: "save",
      status: "error",
      message: "保存设置失败",
    });
    throw new Error("保存设置失败");
  }

  const result = await res.json();
  emitSettingsSyncState({
    phase: "save",
    status: "success",
    message: "设置已同步",
  });
  latestSettingsSavedTimestamp = latestSettingsSyncState?.timestamp ?? Date.now();
  return result.data as UserSettingsPayload;
}

export function subscribeToSettingsSync() {
  settingsSyncSubscriberCount += 1;

  if (settingsSyncSubscriberCount === 1) {
    const initialUser = getCurrentUser();
    settingsSyncSkippedInitialAuthEcho = false;

    const scheduleSave = () => {
      if (
        settingsSyncIsApplyingRemote ||
        !getCurrentUser() ||
        !hasSettingsBackend()
      ) {
        return;
      }

      if (settingsSyncSaveTimer) {
        window.clearTimeout(settingsSyncSaveTimer);
      }

      settingsSyncSaveTimer = window.setTimeout(() => {
        if (settingsSyncSkipNextScheduledSave) {
          settingsSyncSkipNextScheduledSave = false;
          settingsSyncSuppressedSaveSignature = null;
          return;
        }

        const settings = buildUserSettingsPayload();
        const signature = serializeSettingsPayload(settings);
        if (settingsSyncSuppressedSaveSignature === signature) {
          settingsSyncSuppressedSaveSignature = null;
          return;
        }

        void saveUserSettings(settings).catch(() => {
          // Ignore background sync failures; UI remains locally consistent.
        });
      }, 400);
    };

    const syncFromRemote = async () => {
      const user = getCurrentUser();
      const token = getToken();
      if (!user || !token || !hasSettingsBackend()) {
        return;
      }

      const syncKey = `${user.id}:${token}`;
      if (startupSyncPromise && startupSyncKey === syncKey) {
        return startupSyncPromise;
      }

      settingsSyncIsApplyingRemote = true;
      const run = (async () => {
        try {
          const remote = await fetchUserSettings();
          if (remote && hasRemoteSettingsValue(remote)) {
            applyUserSettings(remote);
            settingsSyncSkipNextScheduledSave = true;
            settingsSyncSuppressedSaveSignature = serializeSettingsPayload(
              buildUserSettingsPayload()
            );
          } else {
            await saveUserSettings();
          }
        } finally {
          settingsSyncIsApplyingRemote = false;
          if (startupSyncKey === syncKey) {
            startupSyncPromise = null;
            startupSyncKey = null;
          }
        }
      })();

      startupSyncKey = syncKey;
      startupSyncPromise = run;
      return run;
    };

    const handleSettingsChange = () => scheduleSave();

    window.addEventListener("moyan:theme-change", handleSettingsChange);
    window.addEventListener("moyan:lang-change", handleSettingsChange);
    window.addEventListener(
      "moyan:speech-settings-change",
      handleSettingsChange
    );

    const unsubscribe = onAuthChange((user) => {
      if (
        !settingsSyncSkippedInitialAuthEcho &&
        initialUser &&
        user?.id === initialUser.id
      ) {
        settingsSyncSkippedInitialAuthEcho = true;
        return;
      }
      settingsSyncSkippedInitialAuthEcho = true;

      if (!user) {
        if (settingsSyncSaveTimer) {
          window.clearTimeout(settingsSyncSaveTimer);
          settingsSyncSaveTimer = null;
        }
        return;
      }

      void syncFromRemote();
    });

    if (initialUser) {
      void syncFromRemote();
    }

    settingsSyncCleanup = () => {
      if (settingsSyncSaveTimer) {
        window.clearTimeout(settingsSyncSaveTimer);
        settingsSyncSaveTimer = null;
      }
      unsubscribe();
      window.removeEventListener("moyan:theme-change", handleSettingsChange);
      window.removeEventListener("moyan:lang-change", handleSettingsChange);
      window.removeEventListener(
        "moyan:speech-settings-change",
        handleSettingsChange
      );
      settingsSyncIsApplyingRemote = false;
      settingsSyncSuppressedSaveSignature = null;
      settingsSyncSkipNextScheduledSave = false;
      settingsSyncSkippedInitialAuthEcho = false;
    };
  }

  return () => {
    settingsSyncSubscriberCount = Math.max(0, settingsSyncSubscriberCount - 1);
    if (settingsSyncSubscriberCount === 0 && settingsSyncCleanup) {
      settingsSyncCleanup();
      settingsSyncCleanup = null;
    }
  };
}

function getPrimarySpeechVoice(settings: SpeechSettings): string {
  switch (settings.provider) {
    case "google":
      return settings.googleVoice;
    case "elevenlabs":
      return settings.elevenLabsVoiceId;
    case "aliyun":
      return settings.aliyunVoice;
    default:
      return "webspeech";
  }
}

function getChineseSpeechVoice(settings: SpeechSettings): string | null {
  if (settings.provider === "google") {
    return settings.googleZhVoice;
  }

  if (settings.provider === "elevenlabs") {
    return settings.elevenLabsZhVoiceId;
  }

  return null;
}

function getSpeechModel(settings: SpeechSettings): string | null {
  switch (settings.provider) {
    case "google":
      return settings.googleLanguage;
    case "elevenlabs":
      return settings.elevenLabsModel;
    case "aliyun":
      return settings.aliyunModel;
    default:
      return null;
  }
}

function applyPrimarySpeechVoice(
  settings: SpeechSettings,
  voice: string
): void {
  switch (settings.provider) {
    case "google":
      settings.googleVoice = voice;
      break;
    case "elevenlabs":
      settings.elevenLabsVoiceId = voice;
      break;
    case "aliyun":
      settings.aliyunVoice = voice;
      break;
    default:
      break;
  }
}

function applySpeechModel(
  settings: SpeechSettings,
  model: string
): void {
  switch (settings.provider) {
    case "google":
      settings.googleLanguage = model;
      break;
    case "elevenlabs":
      settings.elevenLabsModel = model;
      break;
    case "aliyun":
      settings.aliyunModel = model;
      break;
    default:
      break;
  }
}
