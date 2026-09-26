import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Plus, FolderOpen, Trash2, BookOpen, ArrowRight } from "lucide-react";
import BottomNav from "../components/BottomNav";
import { db } from "../db";
import type { Deck as LocalDeck } from "../db";
import { initVocabularyDecks } from "../services/vocabularyLoader";
import {
  createDeck,
  deleteDeck,
  getTypeStats,
  hasVocabularyBackend,
  listDecks,
  listTypeMistakes,
} from "../services/vocabularyApi";
import type { Deck as ApiDeck } from "@/types/vocabulary";
import { t } from "../i18n/translations";
import { getCurrentUser } from "../services/authService";

type UiDeck = {
  id: string;
  name: string;
  description: string;
  color?: string | null;
  cardCount: number;
  isSystem: boolean;
  /** 历史打字准确率（0-1），没有打字记录时为 null */
  typingAccuracy?: number | null;
};

function mapApiDeck(deck: ApiDeck): UiDeck {
  return {
    id: deck.id,
    name: deck.name,
    description: deck.description,
    color: deck.color,
    cardCount: deck.card_count,
    isSystem: deck.owner_user_id === "system",
  };
}

function mapLocalDeck(deck: LocalDeck): UiDeck {
  return {
    id: String(deck.id),
    name: deck.name,
    description: deck.description,
    color: deck.color,
    cardCount: deck.cardCount,
    isSystem: false,
  };
}

export default function Decks() {
  const navigate = useNavigate();
  const backend = hasVocabularyBackend();
  const [decks, setDecks] = useState<UiDeck[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const [newDeckDesc, setNewDeckDesc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mistakesCount, setMistakesCount] = useState<number | null>(null);

  useEffect(() => {
    void loadDecks();
  }, []);

  const loadDecks = async () => {
    setLoading(true);
    setError(null);
    try {
      if (backend) {
        if (!getCurrentUser()) {
          navigate("/login");
          return;
        }
        const remote = await listDecks();
        // 词库徽章用的历史准确率（打字记录聚合）；失败就不显示徽章
        const accuracyByDeck = new Map<string, number>();
        try {
          const stats = await getTypeStats();
          for (const row of stats.deck_accuracy ?? []) {
            accuracyByDeck.set(row.deck_id, row.accuracy);
          }
        } catch {
          // stats unavailable → no badges
        }
        setDecks(
          remote.map((deck) => {
            const mapped = mapApiDeck(deck);
            return {
              ...mapped,
              typingAccuracy: accuracyByDeck.get(mapped.id) ?? null,
            };
          })
        );
        try {
          const mistakes = await listTypeMistakes();
          setMistakesCount(mistakes.items.length);
        } catch {
          setMistakesCount(null);
        }
      } else {
        await initVocabularyDecks();
        const local = await db.decks.toArray();
        setDecks(local.map(mapLocalDeck));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "加载牌组失败");
    } finally {
      setLoading(false);
    }
  };

  const systemDecks = decks.filter((d) => d.isSystem);
  const myDecks = decks.filter((d) => !d.isSystem);

  const handleCreateDeck = async () => {
    if (!newDeckName.trim()) return;
    try {
      if (backend) {
        await createDeck({
          name: newDeckName.trim(),
          description: newDeckDesc.trim() || undefined,
          color: "#2B2B2B",
        });
      } else {
        await db.decks.add({
          name: newDeckName.trim(),
          description: newDeckDesc.trim() || "",
          createdAt: new Date(),
          updatedAt: new Date(),
          cardCount: 0,
          color: "#2B2B2B",
        });
      }
      setNewDeckName("");
      setNewDeckDesc("");
      setShowCreate(false);
      await loadDecks();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "创建失败");
    }
  };

  const handleDeleteDeck = async (deck: UiDeck, e: React.MouseEvent) => {
    e.stopPropagation();
    if (deck.isSystem) return;
    if (!confirm(t("decks.delete.confirm"))) return;
    try {
      if (backend) {
        await deleteDeck(deck.id);
      } else {
        const id = Number(deck.id);
        await db.cards.where("deckId").equals(id).delete();
        await db.decks.delete(id);
      }
      await loadDecks();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "删除失败");
    }
  };

  const renderDeckCard = (deck: UiDeck, showDelete: boolean) => (
    <div
      key={deck.id}
      onClick={() => navigate(`/decks/${deck.id}`)}
      className="cursor-pointer w-full text-left bg-[var(--card)] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.05)] hover:shadow-lg transition-all active:scale-[0.99]"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") navigate(`/decks/${deck.id}`);
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: deck.color || "#2B2B2B" }}
            />
            <h3 className="font-medium text-[var(--ink)]">{deck.name}</h3>
          </div>
          {deck.description && (
            <p className="text-xs text-[var(--ink-light)] mb-2">
              {deck.description}
            </p>
          )}
          <p className="text-[11px] text-[var(--ink-light)] flex items-center gap-2">
            <span>
              {deck.cardCount} {t("cards")}
            </span>
            {deck.typingAccuracy != null && (
              <span
                className="px-1.5 py-0.5 rounded tabular-nums"
                style={{
                  backgroundColor: "var(--input-bg)",
                  color:
                    deck.typingAccuracy < 0.9
                      ? "var(--accent)"
                      : "var(--ink-light)",
                }}
              >
                {t("decks.accuracy", {
                  n: Math.round(deck.typingAccuracy * 100),
                })}
              </span>
            )}
          </p>
        </div>
        {showDelete && (
          <button
            onClick={(e) => handleDeleteDeck(deck, e)}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-red-50 transition"
          >
            <Trash2
              size={14}
              className="text-[var(--ink-light)] hover:text-[var(--accent)]"
            />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] paper-texture pb-28">
      <header className="px-6 pt-12 pb-4 flex items-center justify-between">
        <h1 className="font-serif-cn text-2xl font-bold text-[var(--ink)]">
          {t("decks.title")}
        </h1>
        <button
          onClick={() => setShowCreate(true)}
          className="w-9 h-9 rounded-full bg-[var(--btn-bg)] flex items-center justify-center hover:bg-[var(--btn-bg)] transition active:scale-95"
        >
          <Plus size={16} className="text-white" />
        </button>
      </header>

      {error && (
        <div className="px-5 mb-4">
          <div className="bg-red-50 rounded-xl p-3 text-sm text-red-700">
            {error}
          </div>
        </div>
      )}

      <div className="px-5 space-y-6">
        {loading ? (
          <p className="text-sm text-[var(--ink-light)] py-8 text-center">
            加载中…
          </p>
        ) : (
          <>
            {backend && (
              <section className="space-y-3">
                <h2 className="text-sm font-medium text-[var(--ink-light)]">
                  {t("decks.section.system")}
                </h2>
                {systemDecks.map((deck) => renderDeckCard(deck, false))}
                {systemDecks.length === 0 && (
                  <p className="text-xs text-[var(--ink-light)]">暂无系统词库</p>
                )}
              </section>
            )}

            <section className="space-y-3">
              <h2 className="text-sm font-medium text-[var(--ink-light)]">
                {backend ? t("decks.section.mine") : t("decks.title")}
              </h2>
              {backend && (
                <div
                  onClick={() => navigate("/mistakes")}
                  className="cursor-pointer w-full text-left bg-[var(--card)] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.05)] hover:shadow-lg transition-all active:scale-[0.99]"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") navigate("/mistakes");
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[var(--input-bg)] flex items-center justify-center shrink-0">
                      <BookOpen size={16} className="text-[var(--accent)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-[var(--ink)]">
                        {t("decks.mistakes.entry")}
                      </h3>
                      <p className="text-[11px] text-[var(--ink-light)] truncate">
                        {t("mistakes.desc")}
                      </p>
                    </div>
                    {mistakesCount !== null && (
                      <span className="text-[11px] text-[var(--ink-light)] tabular-nums shrink-0">
                        {mistakesCount} {t("word")}
                      </span>
                    )}
                    <ArrowRight
                      size={14}
                      className="text-[var(--ink-muted)] shrink-0"
                    />
                  </div>
                </div>
              )}
              {myDecks.map((deck) => renderDeckCard(deck, true))}
              {myDecks.length === 0 && decks.length === 0 && (
                <div className="text-center py-16">
                  <FolderOpen
                    size={40}
                    className="mx-auto text-[var(--ink-muted)] mb-3"
                  />
                  <p className="text-sm text-[var(--ink-light)]">还没有牌组</p>
                  <p className="text-xs text-[var(--ink-light)] mt-1">
                    {t("decks.no.desc")}
                  </p>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {showCreate && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center"
          onClick={() => setShowCreate(false)}
        >
          <div
            className="bg-[var(--card)] rounded-t-3xl w-full max-w-lg p-6 animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-serif-cn text-xl font-bold text-[var(--ink)] mb-4">
              新建牌组
            </h2>
            <input
              type="text"
              value={newDeckName}
              onChange={(e) => setNewDeckName(e.target.value)}
              placeholder="牌组名称"
              className="w-full px-4 py-3 rounded-xl bg-[var(--input-bg)] text-[var(--ink)] placeholder-[var(--ink-muted)] outline-none focus:ring-2 focus:ring-[var(--ink)]/10 mb-3 text-sm"
            />
            <input
              type="text"
              value={newDeckDesc}
              onChange={(e) => setNewDeckDesc(e.target.value)}
              placeholder="描述（可选）"
              className="w-full px-4 py-3 rounded-xl bg-[var(--input-bg)] text-[var(--ink)] placeholder-[var(--ink-muted)] outline-none focus:ring-2 focus:ring-[var(--ink)]/10 mb-5 text-sm"
            />
            <button
              onClick={handleCreateDeck}
              disabled={!newDeckName.trim()}
              className="w-full py-3 rounded-xl bg-[var(--btn-bg)] text-white text-sm font-medium hover:bg-[var(--btn-bg)] transition disabled:opacity-40"
            >
              {t("decks.new.create")}
            </button>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
