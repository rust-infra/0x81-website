import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { ArrowLeft, Plus, Edit2, Download, Search, Trash2 } from "lucide-react";
import { db } from "../db";
import type { Card as LocalCard } from "../db";
import { exportAnkiPackage, exportCSV } from "../services/anki";
import SpeakButton from "../components/SpeakButton";
import { preloadWebSpeechVoices } from "../services/speechService";
import { t } from "../i18n/translations";
import {
  createCard,
  deleteCard,
  getTypeStats,
  hasVocabularyBackend,
  listCards,
  listDecks,
  updateCard,
} from "../services/vocabularyApi";
import type {
  Card as ApiCard,
  CardExampleInput,
  Deck as ApiDeck,
} from "@/types/vocabulary";
import { getCurrentUser } from "../services/authService";

type ExampleDraft = { sentence_en: string; translation_zh: string };

type UiCard = {
  id: string;
  front: string;
  back: string;
  pronunciation?: string | null;
  tags: string[];
  examples: ExampleDraft[];
  status?: string;
};

export default function DeckDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const backend = hasVocabularyBackend();
  const deckId = id || "";

  const [deckName, setDeckName] = useState("");
  const [cardCount, setCardCount] = useState(0);
  const [isSystem, setIsSystem] = useState(false);
  const [localDeckId, setLocalDeckId] = useState<number | null>(null);
  const [cards, setCards] = useState<UiCard[]>([]);
  const [filteredCards, setFilteredCards] = useState<UiCard[]>([]);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [pronunciation, setPronunciation] = useState("");
  const [tags, setTags] = useState("");
  const [examples, setExamples] = useState<ExampleDraft[]>([]);
  const [exporting, setExporting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  /** 每张卡的历史打字准确率（0-1，没有记录则不在 map 里） */
  const [accuracyByCard, setAccuracyByCard] = useState<Map<string, number>>(
    new Map()
  );

  useEffect(() => {
    void loadData();
    preloadWebSpeechVoices();
  }, [deckId, backend]);

  useEffect(() => {
    if (search.trim()) {
      const q = search.toLowerCase();
      setFilteredCards(
        cards.filter(
          (c) =>
            c.front.toLowerCase().includes(q) ||
            c.back.toLowerCase().includes(q)
        )
      );
    } else {
      setFilteredCards(cards);
    }
  }, [search, cards]);

  const mapApiCard = (card: ApiCard): UiCard => ({
    id: card.id,
    front: card.front,
    back: card.back,
    pronunciation: card.pronunciation,
    tags: card.tags || [],
    examples: (card.examples || []).map((ex) => ({
      sentence_en: ex.sentence_en,
      translation_zh: ex.translation_zh,
    })),
  });

  const mapLocalCard = (card: LocalCard): UiCard => ({
    id: String(card.id),
    front: card.front,
    back: card.back,
    pronunciation: card.pronunciation,
    tags: card.tags || [],
    examples: card.example
      ? [{ sentence_en: card.example, translation_zh: "（暂无中文翻译）" }]
      : [],
    status: card.srs?.status,
  });

  const loadData = async () => {
    try {
      if (backend) {
        if (!getCurrentUser()) {
          navigate("/login");
          return;
        }
        try {
          const stats = await getTypeStats();
          const map = new Map<string, number>();
          for (const row of stats.mastery) {
            // 只有跳过记录（字符数都是 0）时后端 accuracy 是 1.0，那不是"练对了"，不显示徽章
            const chars = (row.correct_chars ?? 0) + (row.wrong_chars ?? 0);
            if (chars > 0) map.set(row.card_id, row.accuracy);
          }
          setAccuracyByCard(map);
        } catch {
          // 打字统计不可用就不显示准确率徽章
        }
        const decks = await listDecks();
        const deck = decks.find((d: ApiDeck) => d.id === deckId);
        if (!deck) {
          navigate("/decks");
          return;
        }
        setDeckName(deck.name);
        setCardCount(deck.card_count);
        setIsSystem(deck.owner_user_id === "system");
        const remoteCards = await listCards(deckId);
        const mapped = remoteCards.map(mapApiCard);
        setCards(mapped);
        setFilteredCards(mapped);
      } else {
        const numericId = Number(deckId);
        const d = await db.decks.get(numericId);
        if (!d) {
          navigate("/decks");
          return;
        }
        setLocalDeckId(numericId);
        setDeckName(d.name);
        setCardCount(d.cardCount);
        setIsSystem(false);
        const localCards = await db.cards
          .where("deckId")
          .equals(numericId)
          .toArray();
        const mapped = localCards.map(mapLocalCard);
        setCards(mapped);
        setFilteredCards(mapped);
      }
      setLoaded(true);
    } catch (err) {
      console.error(err);
      navigate("/decks");
    }
  };

  const resetForm = () => {
    setFront("");
    setBack("");
    setPronunciation("");
    setTags("");
    setExamples([]);
    setEditingCardId(null);
  };

  const validateExamples = (rows: ExampleDraft[]): CardExampleInput[] | null => {
    const cleaned: CardExampleInput[] = [];
    for (const row of rows) {
      const sentence_en = row.sentence_en.trim();
      const translation_zh = row.translation_zh.trim();
      if (!sentence_en && !translation_zh) continue;
      if (!sentence_en || !translation_zh) {
        alert(t("deck.detail.example.invalid"));
        return null;
      }
      cleaned.push({ sentence_en, translation_zh });
    }
    return cleaned;
  };

  const handleSaveCard = async () => {
    if (!front.trim() || !back.trim()) return;
    const examplePayload = validateExamples(examples);
    if (!examplePayload) return;

    try {
      if (backend) {
        const body = {
          front: front.trim(),
          back: back.trim(),
          pronunciation: pronunciation.trim() || undefined,
          tags: tags
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          examples: examplePayload,
        };
        if (editingCardId) {
          await updateCard(editingCardId, body);
        } else {
          await createCard(deckId, body);
        }
      } else if (localDeckId != null) {
        const exampleText = examplePayload[0]
          ? `${examplePayload[0].sentence_en} ${examplePayload[0].translation_zh}`
          : "";
        const existing = editingCardId
          ? await db.cards.get(Number(editingCardId))
          : undefined;
        const cardData = {
          deckId: localDeckId,
          front: front.trim(),
          back: back.trim(),
          pronunciation: pronunciation.trim(),
          example: exampleText,
          tags: tags
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          srs: existing?.srs || {
            interval: 0,
            repetitions: 0,
            easeFactor: 2.5,
            dueDate: new Date(),
            status: "new" as const,
          },
          createdAt: existing?.createdAt || new Date(),
          updatedAt: new Date(),
        };
        if (existing?.id) {
          await db.cards.update(existing.id, cardData);
        } else {
          await db.cards.add(cardData);
          await db.decks.update(localDeckId, {
            cardCount: cards.length + 1,
            updatedAt: new Date(),
          });
        }
      }
      resetForm();
      setShowAdd(false);
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : t("error"));
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    if (!confirm(t("confirm") + "?")) return;
    try {
      if (backend) {
        await deleteCard(cardId);
      } else if (localDeckId != null) {
        await db.cards.delete(Number(cardId));
        await db.decks.update(localDeckId, {
          cardCount: Math.max(0, cards.length - 1),
        });
      }
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : t("error"));
    }
  };

  const startEdit = (card: UiCard) => {
    setEditingCardId(card.id);
    setFront(card.front);
    setBack(card.back);
    setPronunciation(card.pronunciation || "");
    setTags(card.tags.join(", "));
    setExamples(
      card.examples.length
        ? card.examples.map((ex) => ({ ...ex }))
        : []
    );
    setShowAdd(true);
  };

  const handleExportAnki = async () => {
    if (backend || localDeckId == null) return;
    setExporting(true);
    try {
      const blob = await exportAnkiPackage(localDeckId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${deckName || "deck"}.apkg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(t("error") + ": " + err.message);
    }
    setExporting(false);
  };

  const handleExportCSV = async () => {
    if (backend || localDeckId == null) return;
    setExporting(true);
    try {
      const blob = await exportCSV(localDeckId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${deckName || "deck"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(t("error") + ": " + err.message);
    }
    setExporting(false);
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "new":
        return t("deck.detail.status.new");
      case "learning":
        return t("deck.detail.status.learning");
      case "review":
        return t("deck.detail.status.review");
      case "relearning":
        return t("deck.detail.status.relearning");
      default:
        return status;
    }
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case "new":
        return { backgroundColor: "var(--paper)", color: "var(--ink-muted)" };
      case "learning":
        return {
          backgroundColor: "var(--accent-light)",
          color: "var(--accent)",
        };
      case "review":
        return { backgroundColor: "var(--tag-bg)", color: "var(--tag-text)" };
      case "relearning":
        return {
          backgroundColor: "var(--accent-light)",
          color: "var(--accent)",
        };
      default:
        return { backgroundColor: "var(--paper)", color: "var(--ink-muted)" };
    }
  };

  if (!loaded) return null;

  return (
    <div className="min-h-[100dvh] paper-texture pb-6">
      <header className="px-5 pt-5 pb-3 flex items-center gap-3">
        <button
          onClick={() => navigate("/decks")}
          className="w-9 h-9 rounded-full bg-[var(--card)] shadow-sm flex items-center justify-center hover:shadow-md transition"
        >
          <ArrowLeft size={16} className="text-[var(--ink)]" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-serif-cn text-lg font-bold text-[var(--ink)] truncate">
            {deckName}
          </h1>
          <p className="text-[11px] text-[var(--ink-light)]">
            {cardCount} {t("cards")}
            {isSystem ? ` · ${t("decks.section.system")}` : ""}
          </p>
        </div>
        {!isSystem && (
          <button
            onClick={() => {
              resetForm();
              setShowAdd(true);
            }}
            className="w-9 h-9 rounded-full bg-[var(--btn-bg)] flex items-center justify-center hover:bg-[var(--btn-bg)] transition active:scale-95"
          >
            <Plus size={16} className="text-white" />
          </button>
        )}
      </header>

      <div className="px-5 mb-4 space-y-3">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-light)]"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("deck.detail.search")}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[var(--card)] text-sm text-[var(--ink)] placeholder-[var(--ink-muted)] outline-none focus:ring-2 focus:ring-[var(--ink)]/10 shadow-sm"
          />
        </div>
        {!backend && !isSystem && (
          <div className="flex gap-2">
            <button
              onClick={handleExportAnki}
              disabled={exporting}
              className="flex-1 py-2 rounded-lg bg-[var(--card)] text-xs text-[var(--ink)] font-medium shadow-sm flex items-center justify-center gap-1.5 hover:shadow-md transition"
            >
              <Download size={12} />
              Anki
            </button>
            <button
              onClick={handleExportCSV}
              disabled={exporting}
              className="flex-1 py-2 rounded-lg bg-[var(--card)] text-xs text-[var(--ink)] font-medium shadow-sm flex items-center justify-center gap-1.5 hover:shadow-md transition"
            >
              <Download size={12} />
              CSV
            </button>
          </div>
        )}
      </div>

      <div className="px-5 space-y-2">
        {filteredCards.map((card) => (
          <div
            key={card.id}
            className="bg-[var(--card)] rounded-xl p-4 shadow-sm flex items-start gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="font-medium text-[var(--ink)] text-sm">
                  {card.front}
                </p>
                {card.status && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={getStatusStyle(card.status)}
                  >
                    {getStatusLabel(card.status)}
                  </span>
                )}
                {accuracyByCard.has(card.id) && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded tabular-nums shrink-0"
                    style={{
                      backgroundColor: "var(--input-bg)",
                      color:
                        (accuracyByCard.get(card.id) ?? 1) < 0.9
                          ? "var(--accent)"
                          : "var(--ink-light)",
                    }}
                  >
                    {t("deck.detail.accuracy", {
                      n: Math.round((accuracyByCard.get(card.id) ?? 0) * 100),
                    })}
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--ink-light)] truncate">
                {card.back}
              </p>
              {card.examples.map((ex, idx) => (
                <p
                  key={idx}
                  className="text-[11px] text-[var(--ink-light)]/60 italic mt-1 truncate"
                >
                  {ex.sentence_en} — {ex.translation_zh}
                </p>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <SpeakButton
                text={`${card.front}. ${card.back}`}
                size={14}
                className="!bg-[var(--input-bg)] !text-[var(--ink-light)] hover:!bg-[var(--hover)] !p-1.5"
              />
              {!isSystem && (
                <>
                  <button
                    onClick={() => startEdit(card)}
                    className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[var(--input-bg)] transition"
                  >
                    <Edit2 size={12} className="text-[var(--ink-light)]" />
                  </button>
                  <button
                    onClick={() => handleDeleteCard(card.id)}
                    className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-red-50 transition"
                  >
                    <Trash2
                      size={12}
                      className="text-[var(--ink-light)] hover:text-[var(--accent)]"
                    />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}

        {filteredCards.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm text-[var(--ink-light)]">
              {search ? t("search") + "..." : t("deck.detail.no.cards")}
            </p>
          </div>
        )}
      </div>

      {showAdd && !isSystem && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center"
          onClick={() => {
            setShowAdd(false);
            resetForm();
          }}
        >
          <div
            className="bg-[var(--card)] rounded-t-3xl w-full max-w-lg p-6 animate-fade-in-up max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-serif-cn text-xl font-bold text-[var(--ink)] mb-4">
              {editingCardId ? t("edit") : t("add")} {t("cards")}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--ink-light)] mb-1 block">
                  {t("deck.detail.front")} *
                </label>
                <input
                  type="text"
                  value={front}
                  onChange={(e) => setFront(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-[var(--input-bg)] text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--ink)]/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--ink-light)] mb-1 block">
                  {t("deck.detail.back")} *
                </label>
                <textarea
                  value={back}
                  onChange={(e) => setBack(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-3 rounded-xl bg-[var(--input-bg)] text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--ink)]/10 text-sm resize-none"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--ink-light)] mb-1 block">
                  Pronunciation
                </label>
                <input
                  type="text"
                  value={pronunciation}
                  onChange={(e) => setPronunciation(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-[var(--input-bg)] text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--ink)]/10 text-sm"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-[var(--ink-light)]">
                    {t("deck.detail.examples")}
                  </label>
                  <button
                    type="button"
                    className="text-xs text-[var(--accent)]"
                    onClick={() =>
                      setExamples((prev) => [
                        ...prev,
                        { sentence_en: "", translation_zh: "" },
                      ])
                    }
                  >
                    {t("deck.detail.example.add")}
                  </button>
                </div>
                <div className="space-y-2">
                  {examples.map((ex, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl bg-[var(--input-bg)] p-3 space-y-2"
                    >
                      <input
                        type="text"
                        value={ex.sentence_en}
                        onChange={(e) => {
                          const next = [...examples];
                          next[idx] = {
                            ...next[idx],
                            sentence_en: e.target.value,
                          };
                          setExamples(next);
                        }}
                        placeholder={t("deck.detail.example.en")}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--card)] text-[var(--ink)] outline-none text-sm"
                      />
                      <input
                        type="text"
                        value={ex.translation_zh}
                        onChange={(e) => {
                          const next = [...examples];
                          next[idx] = {
                            ...next[idx],
                            translation_zh: e.target.value,
                          };
                          setExamples(next);
                        }}
                        placeholder={t("deck.detail.example.zh")}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--card)] text-[var(--ink)] outline-none text-sm"
                      />
                      <button
                        type="button"
                        className="text-xs text-red-500"
                        onClick={() =>
                          setExamples((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                      >
                        {t("deck.detail.example.remove")}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--ink-light)] mb-1 block">
                  Tags (comma separated)
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-[var(--input-bg)] text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--ink)]/10 text-sm"
                />
              </div>
            </div>

            <button
              onClick={handleSaveCard}
              disabled={!front.trim() || !back.trim()}
              className="w-full py-3 rounded-xl text-sm font-medium transition disabled:opacity-40 mt-4"
              style={{
                backgroundColor: "var(--btn-bg)",
                color: "var(--btn-text)",
              }}
            >
              {editingCardId ? t("save") : t("add")} {t("cards")}
            </button>

            {editingCardId && (
              <button
                onClick={resetForm}
                className="w-full py-2.5 rounded-xl text-sm mt-2 transition hover:opacity-80"
                style={{
                  backgroundColor: "var(--paper)",
                  color: "var(--ink-light)",
                }}
              >
                {t("cancel")}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="h-20" />
    </div>
  );
}
