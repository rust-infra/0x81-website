import type { CollectJob, DraftCard } from "@/api/admin";

export type PreviewRow = DraftCard & { key: string; selected: boolean };

export const PROXY_STORAGE_KEY = "moyan_admin_collect_proxy";
export const PROXY_ENABLED_KEY = "moyan_admin_collect_proxy_enabled";
export const DEFAULT_PROXY = "http://127.0.0.1:7890";
export const POLL_MS = 2000;

export const STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  fetching_captions: "拉取字幕",
  extracting: "LLM 整理",
  ready: "已完成",
  failed: "失败",
  paused: "已暂停",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

export function loadProxyEnabled(): boolean {
  const raw = sessionStorage.getItem(PROXY_ENABLED_KEY);
  if (raw === null) {
    return true;
  }
  return raw === "1";
}

export function loadProxyUrl(): string {
  return sessionStorage.getItem(PROXY_STORAGE_KEY) || DEFAULT_PROXY;
}

export function statusColor(status: string): string {
  switch (status) {
    case "ready":
      return "success";
    case "failed":
      return "error";
    case "paused":
      return "warning";
    case "queued":
      return "default";
    default:
      return "processing";
  }
}

export function isRunningStatus(status: string): boolean {
  return (
    status === "queued" ||
    status === "fetching_captions" ||
    status === "extracting"
  );
}

export function parseExtractStep(step: string): {
  done: number;
  total: number;
} | null {
  const match = /^extracting\s+(\d+)\s*\/\s*(\d+)$/i.exec(step.trim());
  if (!match) {
    return null;
  }
  return { done: Number(match[1]), total: Number(match[2]) };
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) {
    return `${hours}小时${minutes}分${seconds.toString().padStart(2, "0")}秒`;
  }
  if (minutes > 0) {
    return `${minutes}分${seconds.toString().padStart(2, "0")}秒`;
  }
  return `${seconds}秒`;
}

export type LlmProgressView = {
  chunkDone: number;
  chunkTotal: number;
  cardCount: number;
  percent: number;
  elapsedMs: number | null;
  etaMs: number | null;
  active: boolean;
};

export function llmProgressFromJob(
  job: Pick<
    CollectJob,
    | "status"
    | "step"
    | "draft_cards"
    | "draft_card_count"
    | "llm_started_at"
    | "llm_chunk_done"
    | "llm_chunk_total"
    | "finished_at"
  >,
  nowMs: number = Date.now(),
): LlmProgressView | null {
  const fromStep = parseExtractStep(job.step);
  const chunkDone = job.llm_chunk_done ?? fromStep?.done ?? 0;
  const chunkTotal = job.llm_chunk_total ?? fromStep?.total ?? 0;
  const cardCount = job.draft_cards?.length ?? job.draft_card_count ?? 0;
  const touchedLlm =
    Boolean(job.llm_started_at) ||
    job.status === "extracting" ||
    chunkTotal > 0;

  if (!touchedLlm) {
    if (
      (job.status === "ready" || job.status === "failed") &&
      cardCount > 0
    ) {
      return {
        chunkDone: 0,
        chunkTotal: 0,
        cardCount,
        percent: job.status === "ready" ? 100 : 0,
        elapsedMs: null,
        etaMs: null,
        active: false,
      };
    }
    return null;
  }

  const percent =
    chunkTotal > 0
      ? Math.min(100, Math.round((chunkDone / chunkTotal) * 100))
      : job.status === "ready"
        ? 100
        : 0;

  let elapsedMs: number | null = null;
  if (job.llm_started_at) {
    const start = Date.parse(job.llm_started_at);
    if (!Number.isNaN(start)) {
      const end =
        job.status === "extracting"
          ? nowMs
          : job.finished_at
            ? Date.parse(job.finished_at)
            : nowMs;
      if (!Number.isNaN(end)) {
        elapsedMs = Math.max(0, end - start);
      }
    }
  }

  let etaMs: number | null = null;
  if (
    job.status === "extracting" &&
    elapsedMs != null &&
    chunkDone > 0 &&
    chunkTotal > chunkDone
  ) {
    const perChunk = elapsedMs / chunkDone;
    etaMs = Math.round(perChunk * (chunkTotal - chunkDone));
  }

  return {
    chunkDone,
    chunkTotal,
    cardCount,
    percent,
    elapsedMs,
    etaMs,
    active: job.status === "extracting",
  };
}

export function pipelineFromStatus(status: string): {
  current: number;
  items: Array<{
    title: string;
    status: "wait" | "process" | "finish" | "error";
    description?: string;
  }>;
} {
  const titles = ["排队", "拉取字幕", "LLM 整理", "候选就绪"];
  const make = (
    current: number,
    statuses: Array<"wait" | "process" | "finish" | "error">,
    descriptions: Array<string | undefined> = [],
  ) => ({
    current,
    items: titles.map((title, i) => ({
      title,
      status: statuses[i] ?? "wait",
      description: descriptions[i],
    })),
  });

  switch (status) {
    case "queued":
      return make(0, ["process", "wait", "wait", "wait"]);
    case "fetching_captions":
      return make(1, ["finish", "process", "wait", "wait"]);
    case "extracting":
      return make(2, ["finish", "finish", "process", "wait"]);
    case "ready":
      return make(3, ["finish", "finish", "finish", "finish"]);
    case "failed":
      return make(2, ["finish", "finish", "error", "wait"]);
    case "paused":
      return make(1, ["finish", "error", "wait", "wait"]);
    default:
      return make(0, ["wait", "wait", "wait", "wait"]);
  }
}

export function pipelineWithLlmProgress(
  status: string,
  progress: LlmProgressView | null,
): ReturnType<typeof pipelineFromStatus> {
  const base = pipelineFromStatus(status);
  if (!progress) {
    return base;
  }
  const parts: string[] = [];
  if (progress.chunkTotal > 0) {
    parts.push(`分段 ${progress.chunkDone}/${progress.chunkTotal}`);
  }
  parts.push(`词汇 ${progress.cardCount}`);
  if (progress.elapsedMs != null) {
    parts.push(`耗时 ${formatDuration(progress.elapsedMs)}`);
  }
  const description = parts.join(" · ");
  return {
    ...base,
    items: base.items.map((item, index) =>
      index === 2 ? { ...item, description } : item,
    ),
  };
}

export function draftRowsFromJob(job: {
  draft_cards: DraftCard[];
  video_id?: string | null;
}): PreviewRow[] {
  return job.draft_cards.map((card, index) => ({
    ...card,
    key: `${card.front}-${index}`,
    selected: true,
    tags: card.tags?.length
      ? card.tags
      : ["youtube", job.video_id || "yt"],
    examples: card.examples ?? [],
  }));
}
