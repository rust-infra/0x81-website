import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowLeft } from "lucide-react";
import { t } from "../i18n/translations";
import {
  resolvePodcast,
  translatePodcast,
  podcastAudioUrl,
  type PodcastResolved,
  type TimedCaption,
} from "../services/podcastService";
import { podcastPlayer } from "../lib/podcastPlayer";
import { saveRecent } from "../lib/podcastStorage";

export default function PodcastPlayer() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const url = searchParams.get("url") || "";
  const title = searchParams.get("title") || "";
  const channel = searchParams.get("channel") || "";
  const thumbnail = searchParams.get("thumbnail") || "";

  const [data, setData] = useState<PodcastResolved | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [activeIdx, setActiveIdx] = useState(0);
  const [translations, setTranslations] = useState<string[]>([]);
  const [showTrans, setShowTrans] = useState(true);
  const [resumeMs, setResumeMs] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!url) {
      setError(t("podcast.no.captions"));
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resolved = await resolvePodcast(url);
        if (cancelled) return;
        setData(resolved);
        saveRecent({
          id: resolved.video_id,
          title: resolved.title,
          channel: resolved.channel || channel || "",
          thumbnail: resolved.thumbnail || thumbnail || null,
          url,
          at: Date.now(),
        });
        const startMs = await podcastPlayer.ensure({
          videoId: resolved.video_id,
          url: podcastAudioUrl(resolved.video_id),
          youtubeUrl: url,
          title: resolved.title,
          channel: resolved.channel || channel || "",
          captions: resolved.captions,
        });
        if (!cancelled) setResumeMs(startMs);
        translatePodcast(resolved.video_id)
          .then((tr) => {
            const list = tr?.translations || [];
            if (!cancelled) setTranslations(list);
            podcastPlayer.setTranslations(list);
          })
          .catch(() => {
            // translations optional
          });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const unsub = podcastPlayer.subscribe(() => {
      const s = podcastPlayer.getSnapshot();
      setPlaying(s.playing);
      setCurrentMs(s.currentMs);
      setDurationMs(s.durationMs);
      setSpeed(s.speed);
    });
    return () => {
      cancelled = true;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    if (!data || data.captions.length === 0) return;
    const idx = data.captions.findIndex(
      (cap) => currentMs >= cap.start_ms && currentMs < cap.end_ms
    );
    if (idx >= 0 && idx !== activeIdx) {
      setActiveIdx(idx);
      activeRef.current?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }
  }, [currentMs, data, activeIdx]);

  const togglePlay = () => {
    podcastPlayer.togglePlay();
  };

  const jumpTo = (idx: number) => {
    const cap = data?.captions[idx];
    if (!cap) return;
    setActiveIdx(idx);
    podcastPlayer.seekTo(cap.start_ms);
  };

  const cycleSpeed = () => {
    const next =
      speed === 1 ? 1.25 : speed === 1.25 ? 1.5 : speed === 1.5 ? 2 : 1;
    podcastPlayer.setSpeed(next);
  };

  const fmt = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center paper-texture">
        <div
          className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: "var(--accent)" }}
        />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-10 paper-texture">
        <p className="text-sm text-center" style={{ color: "var(--accent)" }}>
          {error || t("podcast.no.captions")}
        </p>
        <button
          onClick={() => navigate(-1)}
          className="px-8 py-2.5 rounded-full text-sm font-medium"
          style={{ backgroundColor: "var(--btn-bg)", color: "var(--btn-text)" }}
        >
          {t("back")}
        </button>
      </div>
    );
  }

  const progressPct =
    durationMs > 0 ? Math.min((currentMs / durationMs) * 100, 100) : 0;

  return (
    <div className="min-h-[100dvh] flex flex-col paper-texture">
      {/* 顶栏 */}
      <header className="flex items-center justify-between px-5 pt-12 pb-2">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <ArrowLeft size={18} style={{ color: "var(--ink)" }} />
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTrans((v) => !v)}
            className="px-3 py-1.5 rounded-full text-xs border"
            style={{
              borderColor: showTrans ? "var(--accent)" : "var(--border)",
              color: showTrans ? "var(--accent)" : "var(--ink-light)",
            }}
          >
            {t("podcast.translate")}
          </button>
          <button
            onClick={cycleSpeed}
            className="px-3 py-1.5 rounded-full text-xs border"
            style={{ borderColor: "var(--border)", color: "var(--ink-light)" }}
          >
            {speed.toFixed(2).replace(/0$/, "")}×
          </button>
        </div>
      </header>

      {/* 标题 */}
      <div className="px-5 pt-2">
        <h1
          className="font-serif-cn text-lg font-bold leading-snug line-clamp-2"
          style={{ color: "var(--ink)" }}
        >
          {data.title}
        </h1>
        {data.channel && (
          <p className="text-xs mt-1" style={{ color: "var(--ink-muted)" }}>
            {data.channel}
          </p>
        )}
        {resumeMs > 0 && (
          <p className="text-[11px] mt-2" style={{ color: "var(--accent)" }}>
            {t("podcast.resumed", { time: fmt(resumeMs) })}
          </p>
        )}
        <span
          className="inline-block rounded-full px-2.5 py-1 text-[10px] mt-2"
          style={{ backgroundColor: "var(--accent-light)", color: "var(--accent)" }}
        >
          {t("podcast.background")}
        </span>
      </div>

      {/* 进度条 */}
      <div className="px-5 pt-4">
        <div
          className="h-1.5 rounded-full overflow-hidden"
          style={{ backgroundColor: "var(--border)" }}
        >
          <div
            className="h-full rounded-full transition-[width] duration-200"
            style={{ backgroundColor: "var(--progress)", width: `${progressPct}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5 text-[11px]" style={{ color: "var(--ink-muted)" }}>
          <span>{fmt(currentMs)}</span>
          <span>{data.duration_sec ? fmt(data.duration_sec * 1000) : fmt(durationMs)}</span>
        </div>
      </div>

      {/* 控制按钮 */}
      <div className="flex items-center justify-center gap-8 py-3">
        <button onClick={() => jumpTo(Math.max(0, activeIdx - 1))} className="text-xl" style={{ color: "var(--ink)" }}>
          ⏮
        </button>
        <button
          onClick={togglePlay}
          className="w-14 h-14 rounded-full flex items-center justify-center text-xl shadow-lg"
          style={{ backgroundColor: "var(--btn-bg)", color: "var(--btn-text)" }}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button
          onClick={() => jumpTo(Math.min(data.captions.length - 1, activeIdx + 1))}
          className="text-xl"
          style={{ color: "var(--ink)" }}
        >
          ⏭
        </button>
      </div>

      {/* 字幕列表 */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-4 pb-8"
      >
        <p className="text-xs px-1 pb-2" style={{ color: "var(--ink-muted)" }}>
          {t("podcast.subs.label")}
        </p>
        <div className="space-y-0.5">
          {data.captions.map((cap: TimedCaption, index: number) => {
            const active = index === activeIdx;
            return (
              <button
                key={`${cap.start_ms}-${index}`}
                ref={active ? activeRef : undefined}
                onClick={() => jumpTo(index)}
                className="w-full text-left flex gap-2.5 px-3 py-2.5 rounded-xl transition-colors"
                style={{
                  backgroundColor: active ? "var(--accent-light)" : "transparent",
                }}
              >
                <span
                  className="text-[11px] mt-0.5 tabular-nums shrink-0"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {fmt(cap.start_ms)}
                </span>
                <span className="flex-1 min-w-0">
                  <span
                    className="block text-sm leading-snug"
                    style={{
                      color: active ? "var(--ink)" : "var(--ink-light)",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {cap.text}
                  </span>
                  {showTrans && translations[index] && (
                    <span className="block text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
                      {translations[index]}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
