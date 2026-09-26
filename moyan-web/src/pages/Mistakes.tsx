import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, BookOpen, Keyboard, Trash2 } from "lucide-react";
import BottomNav from "../components/BottomNav";
import { t } from "../i18n/translations";
import {
  hasVocabularyBackend,
  listTypeMistakes,
  syncTypeMistakes,
} from "../services/vocabularyApi";
import type { TypeMistake } from "@/types/vocabulary";
import { getCurrentUser } from "../services/authService";

function percent(accuracy: number): string {
  return `${Math.round(accuracy * 100)}%`;
}

function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * 错题本：打字练习中打错过的词。
 * 每词显示历史累计准确率与错字次数；再练到 100% 准确率会自动移出，
 * 也可以在这里手动移出。
 */
export default function Mistakes() {
  const navigate = useNavigate();
  const backend = hasVocabularyBackend();
  const [items, setItems] = useState<TypeMistake[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    if (!backend) {
      setLoading(false);
      return;
    }
    if (!getCurrentUser()) {
      navigate("/login");
      return;
    }
    try {
      const data = await listTypeMistakes();
      setItems(data.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("mistakes.load.failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (cardId: string) => {
    const previous = items;
    setItems(prev => prev.filter(item => item.card_id !== cardId));
    try {
      await syncTypeMistakes({ add: [], remove: [cardId] });
    } catch (err: unknown) {
      setItems(previous);
      setError(err instanceof Error ? err.message : t("mistakes.load.failed"));
    }
  };

  return (
    <div className="min-h-[100dvh] paper-texture pb-28">
      <header className="px-6 pt-12 pb-4 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full bg-[var(--input-bg)] flex items-center justify-center transition active:scale-95"
          aria-label={t("back")}
        >
          <ArrowLeft size={16} className="text-[var(--ink)]" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-serif-cn text-2xl font-bold text-[var(--ink)]">
            {t("mistakes.title")}
          </h1>
          <p className="text-[11px] text-[var(--ink-light)] mt-0.5">
            {t("mistakes.desc")}
          </p>
        </div>
        {items.length > 0 && (
          <button
            onClick={() => navigate("/type?deck=mistakes")}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-full bg-[var(--btn-bg)] text-white text-xs font-medium transition active:scale-95"
          >
            <Keyboard size={13} />
            {t("mistakes.practice")}
          </button>
        )}
      </header>

      {error && (
        <div className="px-5 mb-4">
          <div className="bg-red-50 rounded-xl p-3 text-sm text-red-700">
            {error}
          </div>
        </div>
      )}

      <div className="px-5 space-y-2">
        {loading ? (
          <p className="text-sm text-[var(--ink-light)] py-8 text-center">
            {t("loading")}
          </p>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <BookOpen
              size={40}
              className="mx-auto text-[var(--ink-muted)] mb-3"
            />
            <p className="text-sm text-[var(--ink-light)]">
              {t("mistakes.empty")}
            </p>
            <p className="text-xs text-[var(--ink-light)] mt-1">
              {t("mistakes.empty.hint")}
            </p>
          </div>
        ) : (
          items.map(item => {
            const weak = item.accuracy < 0.9;
            return (
              <div
                key={item.card_id}
                className="bg-[var(--card)] rounded-xl p-4 shadow-sm flex items-start gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium text-[var(--ink)] text-sm truncate">
                      {item.card.front}
                    </p>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded tabular-nums shrink-0"
                      style={{
                        backgroundColor: "var(--input-bg)",
                        color: weak ? "var(--accent)" : "var(--ink-light)",
                        fontWeight: weak ? 600 : undefined,
                      }}
                    >
                      {t("mistakes.accuracy")} {percent(item.accuracy)}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--ink-light)] truncate">
                    {item.card.back}
                  </p>
                  <p className="text-[11px] text-[var(--ink-light)]/70 mt-1">
                    {t("mistakes.wrong.count", { n: item.wrong_count })} ·{" "}
                    {t("mistakes.wrong.chars", { n: item.wrong_chars })} ·{" "}
                    {t("mistakes.last", { date: shortDate(item.last_wrong_at) })}
                  </p>
                </div>
                <button
                  onClick={() => handleRemove(item.card_id)}
                  className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[var(--input-bg)] transition shrink-0"
                  title={t("mistakes.remove")}
                >
                  <Trash2
                    size={12}
                    className="text-[var(--ink-light)] hover:text-[var(--accent)]"
                  />
                </button>
              </div>
            );
          })
        )}
      </div>

      <BottomNav />
    </div>
  );
}
