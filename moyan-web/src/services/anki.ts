import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import { db } from '../db';
import type { Card } from '../db';

// 解析 Anki .apkg 文件
export async function importAnkiPackage(file: File): Promise<{ deckName: string; imported: number; failed: number }> {
  const zip = await JSZip.loadAsync(file);

  // 读取 collection.anki2 (SQLite 数据库)
  const dbFile = zip.file('collection.anki2');
  if (!dbFile) {
    throw new Error('无效的 Anki 文件：找不到 collection.anki2');
  }

  const dbBuffer = await dbFile.async('arraybuffer');
  const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
  const sqlite = new SQL.Database(new Uint8Array(dbBuffer));

  // 读取牌组和卡片数据
  const decksResult = sqlite.exec('SELECT id, name FROM decks');
  const notesResult = sqlite.exec(
    'SELECT n.id, n.flds, n.tags, c.type, c.due, c.ivl, c.factor, c.reps FROM notes n JOIN cards c ON n.id = c.nid LIMIT 1000'
  );

  // 读取模型(字段定义)
  const modelsResult = sqlite.exec('SELECT id, name, flds FROM notetypes');

  if (!notesResult || notesResult.length === 0) {
    throw new Error('文件中没有找到卡片数据');
  }

  const decks = decksResult[0]?.values || [];
  const notes = notesResult[0]?.values || [];
  const models = modelsResult[0]?.values || [];

  // 解析字段名
  const fieldMap = new Map<number, string[]>();
  for (const model of models) {
    try {
      const modelId = Number(model[0]);
      const fldsStr = model[2] as string;
      const fldsJson = JSON.parse(fldsStr);
      fieldMap.set(modelId, fldsJson.map((f: any) => f.name));
    } catch {
      // 跳过解析失败的模型
    }
  }

  // 创建牌组
  const deckName = decks.length > 0 ? (decks[0][1] as string).replace(/[\x00-\x1F]/g, '') : '导入的牌组';

  // 检查是否已存在同名牌组
  const existingDeck = await db.decks.where('name').equals(deckName).first();
  if (existingDeck) {
    throw new Error(`已存在名为"${deckName}"的牌组，请删除后重试`);
  }

  const deckId = await db.decks.add({
    name: deckName,
    description: `从 Anki 导入 - ${notes.length} 张卡片`,
    createdAt: new Date(),
    updatedAt: new Date(),
    cardCount: 0,
    color: '#2B2B2B',
  });

  let imported = 0;
  let failed = 0;
  const cardsToAdd: Omit<Card, 'id'>[] = [];

  for (const note of notes) {
    try {
      const fields = (note[1] as string).split('\x1f');
      const tags = (note[2] as string).split(' ').filter(t => t.trim());

      // Anki 字段: 通常是 [正面, 背面]
      const front = fields[0]?.trim() || '';
      const back = fields[1]?.trim() || fields.slice(1).join('<br>').trim() || '';

      if (!front || !back) {
        failed++;
        continue;
      }

      // 解析 SRS 数据
      const interval = Math.max(0, Number(note[5]) || 0);
      const easeFactor = Math.max(1.3, (Number(note[6]) || 2500) / 1000);
      const repetitions = Number(note[7]) || 0;

      // 计算 dueDate
      const dueDays = Number(note[4]) || 0;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + dueDays);

      cardsToAdd.push({
        deckId,
        front,
        back,
        example: '',
        pronunciation: '',
        tags,
        srs: {
          interval,
          repetitions,
          easeFactor,
          dueDate,
          lastReviewed: undefined,
          status: interval === 0 ? 'new' : 'review',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      imported++;
    } catch {
      failed++;
    }
  }

  if (cardsToAdd.length > 0) {
    await db.cards.bulkAdd(cardsToAdd);
    await db.decks.update(deckId, { cardCount: cardsToAdd.length });
  }

  sqlite.close();

  return { deckName, imported, failed };
}

// 导出为 Anki .apkg 文件
export async function exportAnkiPackage(deckId: number): Promise<Blob> {
  const deck = await db.decks.get(deckId);
  if (!deck) throw new Error('牌组不存在');

  const cards = await db.cards.where('deckId').equals(deckId).toArray();
  if (cards.length === 0) throw new Error('牌组中没有卡片');

  const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
  const sqlite = new SQL.Database();

  // 创建 Anki 数据库表结构
  sqlite.run(`
    CREATE TABLE decks (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT NOT NULL, mid INTEGER NOT NULL, mod INTEGER NOT NULL, usn INTEGER NOT NULL, tags TEXT NOT NULL, flds TEXT NOT NULL, sfld TEXT NOT NULL, csum INTEGER NOT NULL, flags INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER NOT NULL, did INTEGER NOT NULL, ord INTEGER NOT NULL, mod INTEGER NOT NULL, usn INTEGER NOT NULL, type INTEGER NOT NULL, queue INTEGER NOT NULL, due INTEGER NOT NULL, ivl INTEGER NOT NULL, factor INTEGER NOT NULL, reps INTEGER NOT NULL, lapses INTEGER NOT NULL, left INTEGER NOT NULL, odue INTEGER NOT NULL, odid INTEGER NOT NULL, flags INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE notetypes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, flds TEXT NOT NULL);
  `);

  const now = Math.floor(Date.now() / 1000);
  const deckDbId = 1;
  const modelId = now;

  // 插入牌组
  sqlite.run('INSERT INTO decks VALUES (?, ?)', [deckDbId, deck.name]);

  // 插入模型
  sqlite.run('INSERT INTO notetypes VALUES (?, ?, ?)', [
    modelId,
    'Basic',
    JSON.stringify([{ name: '正面' }, { name: '背面' }]),
  ]);

  // 插入卡片
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const noteId = 1000000000000 + i;
    const cardId = 1000000000000 + i;
    const flds = `${card.front}\x1f${card.back}`;

    sqlite.run('INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      noteId,
      `guid_${i}`,
      modelId,
      now,
      -1,
      card.tags.join(' '),
      flds,
      card.front.substring(0, 100),
      0,
      0,
      '',
    ]);

    const ivl = card.srs.interval;
    const factor = Math.round(card.srs.easeFactor * 1000);
    const reps = card.srs.repetitions;

    sqlite.run('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      cardId,
      noteId,
      deckDbId,
      0,
      now,
      -1,
      card.srs.status === 'new' ? 0 : 2,
      card.srs.status === 'new' ? 0 : 2,
      ivl,
      ivl,
      factor,
      reps,
      0,
      0,
      0,
      0,
      0,
      '',
    ]);
  }

  // 导出数据库
  const dbData = sqlite.export();

  // 创建 ZIP
  const zip = new JSZip();
  zip.file('collection.anki2', dbData);
  zip.file('media', '{}');

  const blob = await zip.generateAsync({ type: 'blob' });
  sqlite.close();

  return blob;
}

// 导出为 CSV
export async function exportCSV(deckId: number): Promise<Blob> {
  const deck = await db.decks.get(deckId);
  if (!deck) throw new Error('牌组不存在');

  const cards = await db.cards.where('deckId').equals(deckId).toArray();

  const header = 'front,back,pronunciation,example,tags\n';
  const rows = cards.map(c => {
    const front = `"${c.front.replace(/"/g, '""')}"`;
    const back = `"${c.back.replace(/"/g, '""')}"`;
    const pron = `"${(c.pronunciation || '').replace(/"/g, '""')}"`;
    const ex = `"${(c.example || '').replace(/"/g, '""')}"`;
    const tags = `"${c.tags.join(',')}"`;
    return `${front},${back},${pron},${ex},${tags}`;
  }).join('\n');

  return new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
}
