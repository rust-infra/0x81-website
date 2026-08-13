import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, Headphones, Search, Clock } from "lucide-react";
import { t } from "../i18n/translations";
import { getAppConfig } from "../services/podcastService";
import {
  loadRecent,
  saveSearchCache,
  loadSearchCache,
  type RecentItem,
} from "../lib/podcastStorage";

interface SearchItem {
  id: string;
  title: string;
  channel: string;
  thumbnail: string | null;
}

export default function Podcast() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"home" | "results">("home");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [nextPageToken, setNextPageToken] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const apiKeyRef = useRef("");
  const searchAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const queryRef = useRef("");

  useEffect(() => {
    getAppConfig()
      .then((cfg) => {
        apiKeyRef.current = cfg.podcast?.youtube_api_key || "";
        setDisabled(cfg.podcast ? !cfg.podcast.web_enabled : false);
      })
      .catch(() => {});
    setRecent(loadRecent());
  }, []);

  const search = async (pageToken?: string) => {
    const q = pageToken ? queryRef.current : query.trim();
    if (!q || loading) return;
    if (!apiKeyRef.current) {
      setError(t("podcast.no.key"));
      return;
    }
    if (!pageToken) queryRef.current = q;

    if (!pageToken) {
      const cached = loadSearchCache(q);
      if (cached) {
        setResults(cached.items);
        setNextPageToken(cached.nextPageToken || "");
        setMode("results");
        setError("");
        return;
      }
      setLoading(true);
      setError("");
    } else {
      setLoadingMore(true);
    }

    searchAbortRef.current?.abort();
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    if (pageToken) loadMoreAbortRef.current = controller;
    else searchAbortRef.current = controller;

    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const params = new URLSearchParams({
        part: "snippet",
        type: "video",
        maxResults: "20",
        q,
        key: apiKeyRef.current,
      });
      if (pageToken) params.set("pageToken", pageToken);
      const url = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
      const res = await fetch(url, { signal: controller.signal });
      const body = await res.json();
      const items: SearchItem[] = (body.items || [])
        .map(
          (it: {
            id?: { videoId?: string };
            snippet?: {
              title?: string;
              channelTitle?: string;
              thumbnails?: Record<string, { url?: string }>;
            };
          }) => ({
            id: it.id?.videoId || "",
            title: it.snippet?.title || "",
            channel: it.snippet?.channelTitle || "",
            thumbnail:
              it.snippet?.thumbnails?.high?.url ||
              it.snippet?.thumbnails?.default?.url ||
              null,
          })
        )
        .filter((i: SearchItem) => i.id);
      if (pageToken) {
        setResults((prev) => {
          const seen = new Set(prev.map((i) => i.id));
          return [...prev, ...items.filter((i) => !seen.has(i.id))];
        });
        setNextPageToken(body.nextPageToken || "");
      } else {
        setResults(items);
        setNextPageToken(body.nextPageToken || "");
        setMode("results");
        if (items.length > 0) {
          saveSearchCache(q, items, body.nextPageToken || "");
        }
      }
    } catch (e) {
      if (!pageToken) {
        if (controller.signal.aborted) {
          setError(t("podcast.timeout"));
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    } finally {
      clearTimeout(timer);
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
      loadMoreAbortRef.current?.abort();
    };
  }, []);

  const openPlayer = (item: SearchItem, url: string) => {
    navigate(`/podcast/player?url=${encodeURIComponent(url)}&title=${encodeURIComponent(item.title)}&channel=${encodeURIComponent(item.channel)}&thumbnail=${encodeURIComponent(item.thumbnail || "")}`);
  };

  const renderCard = (item: SearchItem, url: string) => (
    <button
      key={item.id}
      onClick={() => openPlayer(item, url)}
      className="w-full text-left flex items-center gap-3 p-3 rounded-2xl transition-all active:scale-[0.98] hover:shadow-md"
      style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
    >
      {item.thumbnail ? (
        <img
          src={item.thumbnail}
          alt=""
          className="w-20 h-14 rounded-lg object-cover shrink-0"
        />
      ) : (
        <div
          className="w-20 h-14 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: "var(--accent-light)" }}
        >
          <Headphones size={20} style={{ color: "var(--accent)" }} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-medium line-clamp-2"
          style={{ color: "var(--ink)" }}
        >
          {item.title}
        </p>
        <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--ink-muted)" }}>
          {item.channel}
        </p>
      </div>
    </button>
  );

  return (
    <div className="min-h-[100dvh] paper-texture pb-28">
      <header className="px-6 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
          >
            <ArrowLeft size={18} style={{ color: "var(--ink)" }} />
          </button>
          <h1 className="font-serif-cn text-2xl font-bold" style={{ color: "var(--ink)" }}>
            {t("podcast.training")}
          </h1>
        </div>

        {disabled ? (
          <div
            className="rounded-2xl p-4 text-sm"
            style={{ backgroundColor: "var(--accent-light)", color: "var(--accent)" }}
          >
            {t("podcast.disabled")}
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
            className="flex gap-2"
          >
            <div className="flex-1 relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: "var(--ink-muted)" }}
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("podcast.search.placeholder")}
                className="w-full rounded-2xl pl-9 pr-3 py-3 text-sm outline-none"
                style={{
                  backgroundColor: "var(--input-bg)",
                  border: "1px solid var(--border)",
                  color: "var(--ink)",
                }}
              />
            </div>
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="px-5 rounded-2xl text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: "var(--btn-bg)", color: "var(--btn-text)" }}
            >
              {t("search")}
            </button>
          </form>
        )}
      </header>

      {error && (
        <div className="px-6 mb-3">
          <p className="text-sm" style={{ color: "var(--accent)" }}>
            {error}
          </p>
        </div>
      )}

      <main className="px-5">
        {mode === "home" && !error && (
          <section>
            <h2
              className="text-xs font-medium mb-3 px-1 flex items-center gap-1"
              style={{ color: "var(--ink-muted)" }}
            >
              <Clock size={12} /> {t("podcast.recent")}
            </h2>
            {recent.length === 0 ? (
              <p className="text-sm px-1" style={{ color: "var(--ink-light)" }}>
                {t("podcast.recent.empty")}
              </p>
            ) : (
              <div className="space-y-2">
                {recent.map((item) =>
                  renderCard(
                    {
                      id: item.id,
                      title: item.title,
                      channel: item.channel,
                      thumbnail: item.thumbnail,
                    },
                    item.url
                  )
                )}
              </div>
            )}
          </section>
        )}

        {mode === "results" && (
          <section>
            <h2
              className="text-xs font-medium mb-3 px-1"
              style={{ color: "var(--ink-muted)" }}
            >
              {t("podcast.results")} ({results.length})
            </h2>
            {results.length === 0 ? (
              <p className="text-sm px-1" style={{ color: "var(--ink-light)" }}>
                {t("podcast.no.results")}
              </p>
            ) : (
              <div className="space-y-2">
                {results.map((item) =>
                  renderCard(item, `https://www.youtube.com/watch?v=${item.id}`)
                )}
              </div>
            )}
            {nextPageToken && (
              <button
                onClick={() => void search(nextPageToken)}
                disabled={loadingMore}
                className="w-full mt-4 py-3 rounded-2xl text-sm font-medium disabled:opacity-50"
                style={{
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--border)",
                  color: "var(--ink)",
                }}
              >
                {loadingMore ? t("loading") : t("podcast.load.more")}
              </button>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
