import { existsSync } from 'node:fs';

const dataPath = new URL('../.test-dist/lib/english-learning-data.js', import.meta.url);
if (!existsSync(dataPath)) {
  console.error('missing .test-dist data; run `npm test` first');
  process.exit(1);
}
const { ENGLISH_LESSONS } = await import(dataPath.href);

const base = (process.env.DIGITAL_HUMAN_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
const args = process.argv.slice(2);

function arg(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

const deck = arg('deck', undefined);
const lesson = arg('lesson', undefined);
const limit = Number(arg('limit', 0)) || 0;
const dryRun = arg('dry-run', false) === true;
const wait = arg('wait', false) === true;

const texts = [];
for (const item of ENGLISH_LESSONS) {
  if (deck && item.deck !== deck) continue;
  if (lesson && item.number !== Number(lesson)) continue;
  for (const dialogue of item.dialogues) {
    for (const turn of dialogue.scenario.dialogue ?? []) {
      const text = turn.content.replace(/\s+/g, ' ').trim();
      if (text) texts.push(text);
    }
  }
}

const unique = [...new Set(texts)];
const selected = limit > 0 ? unique.slice(0, limit) : unique;

if (dryRun) {
  console.log(`lessons=${ENGLISH_LESSONS.length} unique=${unique.length} selected=${selected.length}`);
  selected.slice(0, 5).forEach((text) => console.log(`- ${text.slice(0, 90)}`));
  process.exit(0);
}

async function request(text) {
  const res = await fetch(`${base}/v1/clips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return res.json();
}

async function status(key) {
  const res = await fetch(`${base}/v1/clips/${key}`);
  if (!res.ok) throw new Error(`status failed: ${res.status}`);
  return res.json();
}

const jobs = [];
for (const [index, text] of selected.entries()) {
  const job = await request(text);
  jobs.push(job);
  console.log(
    `${String(index + 1).padStart(3)}/${selected.length} ${job.status.padEnd(8)} ${job.key} ${text.slice(0, 60)}`
  );
}

if (!wait) {
  console.log(`enqueued ${jobs.length}; rerun with --wait to follow progress`);
  process.exit(0);
}

const started = Date.now();
let remaining = jobs.map((job) => job.key);
let readyTotal = 0;
let failedTotal = 0;
while (remaining.length > 0) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const next = [];
  for (const key of remaining) {
    const current = await status(key);
    if (current.status === 'ready') readyTotal++;
    else if (current.status === 'failed') failedTotal++;
    else next.push(key);
  }
  remaining = next;
  const done = jobs.length - remaining.length;
  console.log(
    `progress ${done}/${jobs.length} ready=${readyTotal} failed=${failedTotal} waiting=${remaining.length}`
  );
}

console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
