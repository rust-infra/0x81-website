import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { ArrowLeft, Plus, Edit2, Download, Search, Trash2 } from 'lucide-react';
import { db } from '../db';
import type { Deck, Card } from '../db';
import { exportAnkiPackage, exportCSV } from '../services/anki';
import SpeakButton from '../components/SpeakButton';
import { preloadWebSpeechVoices } from '../services/speechService';
import { t } from '../i18n/translations';

export default function DeckDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const deckId = Number(id);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [filteredCards, setFilteredCards] = useState<Card[]>([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [pronunciation, setPronunciation] = useState('');
  const [example, setExample] = useState('');
  const [tags, setTags] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadData();
    preloadWebSpeechVoices();
  }, [deckId]);

  useEffect(() => {
    if (search.trim()) {
      const q = search.toLowerCase();
      setFilteredCards(cards.filter(c =>
        c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q)
      ));
    } else {
      setFilteredCards(cards);
    }
  }, [search, cards]);

  const loadData = async () => {
    const d = await db.decks.get(deckId);
    if (!d) { navigate('/decks'); return; }
    setDeck(d);
    const c = await db.cards.where('deckId').equals(deckId).toArray();
    setCards(c);
    setFilteredCards(c);
  };

  const resetForm = () => {
    setFront('');
    setBack('');
    setPronunciation('');
    setExample('');
    setTags('');
    setEditingCard(null);
  };

  const handleSaveCard = async () => {
    if (!front.trim() || !back.trim()) return;

    const cardData = {
      deckId,
      front: front.trim(),
      back: back.trim(),
      pronunciation: pronunciation.trim(),
      example: example.trim(),
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      srs: editingCard ? editingCard.srs : { interval: 0, repetitions: 0, easeFactor: 2.5, dueDate: new Date(), status: 'new' as const },
      createdAt: editingCard ? editingCard.createdAt : new Date(),
      updatedAt: new Date(),
    };

    if (editingCard?.id) {
      await db.cards.update(editingCard.id, cardData);
    } else {
      await db.cards.add(cardData);
    }

    await db.decks.update(deckId, {
      cardCount: editingCard ? cards.length : cards.length + 1,
      updatedAt: new Date(),
    });

    resetForm();
    setShowAdd(false);
    loadData();
  };

  const handleDeleteCard = async (cardId: number) => {
    if (!confirm(t('confirm') + '?')) return;
    await db.cards.delete(cardId);
    await db.decks.update(deckId, { cardCount: Math.max(0, cards.length - 1) });
    loadData();
  };

  const startEdit = (card: Card) => {
    setEditingCard(card);
    setFront(card.front);
    setBack(card.back);
    setPronunciation(card.pronunciation || '');
    setExample(card.example || '');
    setTags(card.tags.join(', '));
    setShowAdd(true);
  };

  const handleExportAnki = async () => {
    setExporting(true);
    try {
      const blob = await exportAnkiPackage(deckId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${deck?.name || 'deck'}.apkg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(t('error') + ': ' + err.message);
    }
    setExporting(false);
  };

  const handleExportCSV = async () => {
    setExporting(true);
    try {
      const blob = await exportCSV(deckId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${deck?.name || 'deck'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(t('error') + ': ' + err.message);
    }
    setExporting(false);
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'new': return t('deck.detail.status.new');
      case 'learning': return t('deck.detail.status.learning');
      case 'review': return t('deck.detail.status.review');
      case 'relearning': return t('deck.detail.status.relearning');
      default: return status;
    }
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'new': return { backgroundColor: 'var(--paper)', color: 'var(--ink-muted)' };
      case 'learning': return { backgroundColor: 'var(--accent-light)', color: 'var(--accent)' };
      case 'review': return { backgroundColor: 'var(--tag-bg)', color: 'var(--tag-text)' };
      case 'relearning': return { backgroundColor: 'var(--accent-light)', color: 'var(--accent)' };
      default: return { backgroundColor: 'var(--paper)', color: 'var(--ink-muted)' };
    }
  };

  if (!deck) return null;

  return (
    <div className="min-h-[100dvh] paper-texture pb-6">
      {/* 顶部 */}
      <header className="px-5 pt-5 pb-3 flex items-center gap-3">
        <button
          onClick={() => navigate('/decks')}
          className="w-9 h-9 rounded-full bg-[var(--card)] shadow-sm flex items-center justify-center hover:shadow-md transition"
        >
          <ArrowLeft size={16} className="text-[var(--ink)]" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-serif-cn text-lg font-bold text-[var(--ink)] truncate">{deck.name}</h1>
          <p className="text-[11px] text-[var(--ink-light)]">{deck.cardCount} {t('cards')}</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowAdd(true); }}
          className="w-9 h-9 rounded-full bg-[var(--btn-bg)] flex items-center justify-center hover:bg-[var(--btn-bg)] transition active:scale-95"
        >
          <Plus size={16} className="text-white" />
        </button>
      </header>

      {/* Search & Export */}
      <div className="px-5 mb-4 space-y-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-light)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('deck.detail.search')}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[var(--card)] text-sm text-[var(--ink)] placeholder-[var(--ink-muted)] outline-none focus:ring-2 focus:ring-[var(--ink)]/10 shadow-sm"
          />
        </div>
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
      </div>

      {/* Card list */}
      <div className="px-5 space-y-2">
        {filteredCards.map(card => (
          <div
            key={card.id}
            className="bg-[var(--card)] rounded-xl p-4 shadow-sm flex items-start gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="font-medium text-[var(--ink)] text-sm">{card.front}</p>
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={getStatusStyle(card.srs.status)}>
                  {getStatusLabel(card.srs.status)}
                </span>
              </div>
              <p className="text-xs text-[var(--ink-light)] truncate">{card.back}</p>
              {card.example && (
                <p className="text-[11px] text-[var(--ink-light)]/60 italic mt-1 truncate">{card.example}</p>
              )}
            </div>
            <div className="flex items-center gap-1">
              <SpeakButton
                text={`${card.front}. ${card.back}`}
                size={14}
                className="!bg-[var(--input-bg)] !text-[var(--ink-light)] hover:!bg-[var(--hover)] !p-1.5"
              />
              <button
                onClick={() => startEdit(card)}
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[var(--input-bg)] transition"
              >
                <Edit2 size={12} className="text-[var(--ink-light)]" />
              </button>
              <button
                onClick={() => handleDeleteCard(card.id!)}
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-red-50 transition"
              >
                <Trash2 size={12} className="text-[var(--ink-light)] hover:text-[var(--accent)]" />
              </button>
            </div>
          </div>
        ))}

        {filteredCards.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm text-[var(--ink-light)]">
              {search ? t('search') + '...' : t('deck.detail.no.cards')}
            </p>
          </div>
        )}
      </div>

      {/* Add/Edit Card Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center" onClick={() => { setShowAdd(false); resetForm(); }}>
          <div
            className="bg-[var(--card)] rounded-t-3xl w-full max-w-lg p-6 animate-fade-in-up max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="font-serif-cn text-xl font-bold text-[var(--ink)] mb-4">
              {editingCard ? t('edit') : t('add')} {t('cards')}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--ink-light)] mb-1 block">{t('deck.detail.front')} *</label>
                <input
                  type="text"
                  value={front}
                  onChange={e => setFront(e.target.value)}
                  placeholder="English word"
                  className="w-full px-4 py-3 rounded-xl bg-[var(--input-bg)] text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--ink)]/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--ink-light)] mb-1 block">{t('deck.detail.back')} *</label>
                <textarea
                  value={back}
                  onChange={e => setBack(e.target.value)}
                  placeholder="Meaning"
                  rows={2}
                  className="w-full px-4 py-3 rounded-xl bg-[var(--input-bg)] text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--ink)]/10 text-sm resize-none"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--ink-light)] mb-1 block">Pronunciation</label>
                <input
                  type="text"
                  value={pronunciation}
                  onChange={e => setPronunciation(e.target.value)}
                  placeholder="/ˈep.ək/"
                  className="w-full px-4 py-3 rounded-xl bg-[var(--input-bg)] text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--ink)]/10 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--ink-light)] mb-1 block">{t('deck.detail.example')}</label>
                <textarea
                  value={example}
                  onChange={e => setExample(e.target.value)}
                  placeholder="Example sentence"
                  rows={2}
                  className="w-full px-4 py-3 rounded-xl bg-[var(--input-bg)] text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--ink)]/10 text-sm resize-none"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--ink-light)] mb-1 block">Tags (comma separated)</label>
                <input
                  type="text"
                  value={tags}
                  onChange={e => setTags(e.target.value)}
                  placeholder="如 noun, CET-4"
                  className="w-full px-4 py-3 rounded-xl bg-[var(--input-bg)] text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--ink)]/10 text-sm"
                />
              </div>
            </div>

            <button
              onClick={handleSaveCard}
              disabled={!front.trim() || !back.trim()}
              className="w-full py-3 rounded-xl text-sm font-medium transition disabled:opacity-40 mt-4"
              style={{ backgroundColor: 'var(--btn-bg)', color: 'var(--btn-text)' }}
            >
              {editingCard ? t('save') : t('add')} {t('cards')}
            </button>

            {editingCard && (
              <button
                onClick={resetForm}
                className="w-full py-2.5 rounded-xl text-sm mt-2 transition hover:opacity-80"
                style={{ backgroundColor: 'var(--paper)', color: 'var(--ink-light)' }}
              >
                {t('cancel')}
              </button>
            )}
     
          </div>
        </div>
      )}

      <div className="h-20" />
    </div>
  );
}