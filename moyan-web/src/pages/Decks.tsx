import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Upload, FolderOpen, Trash2 } from 'lucide-react';
import BottomNav from '../components/BottomNav';
import { db } from '../db';
import type { Deck } from '../db';
import { importAnkiPackage } from '../services/anki';
import { initVocabularyDecks } from '../services/vocabularyLoader';
import { t } from '../i18n/translations';

export default function Decks() {
  const navigate = useNavigate();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [newDeckDesc, setNewDeckDesc] = useState('');
  [newDeckDesc, setNewDeckDesc]; // used by form
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    initVocabularyDecks().then(loadDecks);
  }, []);

  const loadDecks = async () => {
    const allDecks = await db.decks.toArray();
    setDecks(allDecks);
  };

  // Split decks: 30-day plan vs others
  const thirtyDayDecks = decks.filter(d => d.name === '30天词汇');
  const otherDecks = decks.filter(d => d.name !== '30天词汇');

  const handleCreateDeck = async () => {
    if (!newDeckName.trim()) return;
    await db.decks.add({
      name: newDeckName.trim(),
      description: newDeckDesc.trim() || '',
      createdAt: new Date(),
      updatedAt: new Date(),
      cardCount: 0,
      color: '#2B2B2B',
    });
    setNewDeckName('');
    setNewDeckDesc('');
    setShowCreate(false);
    loadDecks();
  };

  const handleDeleteDeck = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(t('decks.delete.confirm'))) return;
    await db.cards.where('deckId').equals(id).delete();
    await db.decks.delete(id);
    loadDecks();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      if (file.name.endsWith('.apkg') || file.name.endsWith('.anki2')) {
        const result = await importAnkiPackage(file);
        alert(`Import success!\nDeck: ${result.deckName}\nSuccess: ${result.imported}\nFailed: ${result.failed}`);
      } else if (file.name.endsWith('.csv')) {
        await importCSV(file);
        alert('CSV import success!');
      } else {
        alert('Unsupported format. Upload .apkg (Anki), .anki2 or .csv');
      }
      loadDecks();
    } catch (err: any) {
      alert('导入失败：' + err.message);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const importCSV = async (file: File) => {
    const text = await file.text();
    const lines = text.trim().split('\n');
    if (lines.length < 2) throw new Error('CSV 文件为空');

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const deckId = await db.decks.add({
      name: 'CSV 导入 ' + new Date().toLocaleDateString(),
      description: `从 ${file.name} 导入`,
      createdAt: new Date(),
      updatedAt: new Date(),
      cardCount: 0,
    });

    const cards: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      const getField = (name: string) => {
        const idx = headers.indexOf(name);
        return idx >= 0 ? values[idx] || '' : '';
      };

      const front = getField('front');
      const back = getField('back');
      if (!front || !back) continue;

      cards.push({
        deckId,
        front,
        back,
        pronunciation: getField('pronunciation'),
        example: getField('example'),
        tags: getField('tags').split(',').filter(Boolean),
        srs: { interval: 0, repetitions: 0, easeFactor: 2.5, dueDate: new Date(), status: 'new' as const },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    if (cards.length > 0) {
      await db.cards.bulkAdd(cards);
      await db.decks.update(deckId, { cardCount: cards.length });
    }
  };

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result.map(v => v.replace(/^"|"$/g, ''));
  };

  return (
    <div className="min-h-[100dvh] paper-texture pb-28">
      {/* 顶部 */}
      <header className="px-6 pt-12 pb-4 flex items-center justify-between">
        <h1 className="font-serif-cn text-2xl font-bold text-[var(--ink)]">{t('decks.title')}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="w-9 h-9 rounded-full bg-[var(--card)] shadow-[0_1px_3px_rgba(0,0,0,0.05)] flex items-center justify-center hover:shadow-lg transition active:scale-95"
          >
            <Upload size={16} className="text-[var(--ink-light)]" />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="w-9 h-9 rounded-full bg-[var(--btn-bg)] flex items-center justify-center hover:bg-[var(--btn-bg)] transition active:scale-95"
          >
            <Plus size={16} className="text-white" />
          </button>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".apkg,.anki2,.csv"
        className="hidden"
        onChange={handleImportFile}
      />

      {/* 导入提示 */}
      {importing && (
        <div className="px-5 mb-4">
          <div className="bg-[var(--accent-light)] rounded-xl p-3 text-sm text-[var(--accent)]">
            Importing Anki file...
          </div>
        </div>
      )}

      {/* 牌组列表 */}
      <div className="px-5 space-y-3">
        {/* 30天词汇 */}
        {thirtyDayDecks.map((deck) => (
          <div
            key={deck.id}
            onClick={() => navigate(`/decks/${deck.id}`)}
            className="cursor-pointer w-full text-left bg-[var(--card)] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.05)] hover:shadow-lg transition-all active:scale-[0.99]"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/decks/${deck.id}`); }}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: deck.color || '#2B2B2B' }}
                  />
                  <h3 className="font-medium text-[var(--ink)]">{deck.name}</h3>
                </div>
                <p className="text-xs text-[var(--ink-light)] mb-2">{t('decks.30day.desc')}</p>
                <p className="text-[11px] text-[var(--ink-light)]">{deck.cardCount} {t('cards')}</p>
              </div>
              <button
                onClick={(e) => handleDeleteDeck(deck.id!, e)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-red-50 transition"
              >
                <Trash2 size={14} className="text-[var(--ink-light)] hover:text-[var(--accent)]" />
              </button>
            </div>
          </div>
        ))}

        {/* 其他牌组 */}
        {otherDecks.map((deck) => (
          <div
            key={deck.id}
            onClick={() => navigate(`/decks/${deck.id}`)}
            className="cursor-pointer w-full text-left bg-[var(--card)] rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.05)] hover:shadow-lg transition-all active:scale-[0.99]"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/decks/${deck.id}`); }}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: deck.color || '#2B2B2B' }}
                  />
                  <h3 className="font-medium text-[var(--ink)]">{deck.name}</h3>
                </div>
                {deck.description && (
                  <p className="text-xs text-[var(--ink-light)] mb-2">{deck.description}</p>
                )}
                <p className="text-[11px] text-[var(--ink-light)]">{deck.cardCount} 张卡片</p>
              </div>
              <button
                onClick={(e) => handleDeleteDeck(deck.id!, e)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-red-50 transition"
              >
                <Trash2 size={14} className="text-[var(--ink-light)] hover:text-[var(--accent)]" />
              </button>
            </div>
          </div>
        ))}

        {decks.length === 0 && (
          <div className="text-center py-16">
            <FolderOpen size={40} className="mx-auto text-[var(--ink-muted)] mb-3" />
            <p className="text-sm text-[var(--ink-light)]">还没有牌组</p>
            <p className="text-xs text-[var(--ink-light)] mt-1">{t('decks.no.desc')}</p>
          </div>
        )}
      </div>

      {/* Create deck modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center" onClick={() => setShowCreate(false)}>
          <div
            className="bg-[var(--card)] rounded-t-3xl w-full max-w-lg p-6 animate-fade-in-up"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="font-serif-cn text-xl font-bold text-[var(--ink)] mb-4">新建牌组</h2>
            <input
              type="text"
              value={newDeckName}
              onChange={e => setNewDeckName(e.target.value)}
              placeholder="牌组名称"
              className="w-full px-4 py-3 rounded-xl bg-[var(--input-bg)] text-[var(--ink)] placeholder-[var(--ink-muted)] outline-none focus:ring-2 focus:ring-[var(--ink)]/10 mb-3 text-sm"
            />
            <input
              type="text"
              onChange={e => setNewDeckDesc(e.target.value)}
              placeholder="描述（可选）"
              className="w-full px-4 py-3 rounded-xl bg-[var(--input-bg)] text-[var(--ink)] placeholder-[var(--ink-muted)] outline-none focus:ring-2 focus:ring-[var(--ink)]/10 mb-5 text-sm"
            />
            <button
              onClick={handleCreateDeck}
              disabled={!newDeckName.trim()}
              className="w-full py-3 rounded-xl bg-[var(--btn-bg)] text-white text-sm font-medium hover:bg-[var(--btn-bg)] transition disabled:opacity-40"
            >
              {t('decks.new.create')}
            </button>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
