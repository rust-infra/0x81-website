// 把所有播客剧集的中文字幕**提前生成并入库**。
//
// 播放器不再实时翻译（逐句调用看不到上下文，译文会飘），所以译文必须在
// 上线前预生成一遍。这个脚本就是那条预生成路径：对每一集调用一次
// `/api/rehearse/podcast/translations/generate`，服务端整集翻译后写库。
//
// 服务端是幂等的：已经生成过的集直接返回缓存，不会重复调 LLM。
// 所以这个脚本可以随手重跑，也可以只跑某一册/某一课。
//
// 用法：
//   API_URL=https://rehearse.0x81.uk TOKEN=<jwt> \
//     node scripts/prefetch-translations.mjs [--deck 第一册] [--lesson 3] [--dry-run]
//
// 本地开发要先把后端跑起来，并把 LLM 配好（见 README 与
// `PUT /api/admin/settings/rehearse`），否则每一集都会拿到 503。

import { existsSync } from 'node:fs';

const dataPath = new URL('../.test-dist/lib/english-learning-data.js', import.meta.url);
if (!existsSync(dataPath)) {
  console.error('missing .test-dist data; run `npm test` first');
  process.exit(1);
}
const { ENGLISH_LESSONS } = await import(dataPath.href);
const { buildPodcastEpisodes } = await import(
  new URL('../.test-dist/lib/podcast.js', import.meta.url).href
);
const { episodeSourceLines, episodeSpeakers, podcastSourceHash } = await import(
  new URL('../.test-dist/lib/podcast-source-hash.js', import.meta.url).href
);

const base = (process.env.API_URL || 'http://127.0.0.1:4324').replace(/\/$/, '');
const token = process.env.TOKEN || '';
const args = process.argv.slice(2);

function arg(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

const deck = arg('deck', undefined);
const lesson = arg('lesson', undefined);
const dryRun = arg('dry-run', false) === true;

const episodes = buildPodcastEpisodes(deck).filter(
  (episode) => !lesson || episode.lessonNumber === Number(lesson)
);

if (episodes.length === 0) {
  console.error('no episodes matched');
  process.exit(1);
}
if (!dryRun && !token) {
  console.error('TOKEN is required (a logged-in user JWT)');
  process.exit(1);
}

if (dryRun) {
  console.log(`episodes=${episodes.length} deck=${deck || 'all'} lesson=${lesson || 'all'}`);
  for (const episode of episodes.slice(0, 5)) {
    const lines = episodeSourceLines(episode);
    console.log(`- ${episode.id} turns=${lines.length} hash=${podcastSourceHash(lines).slice(0, 12)}`);
  }
  process.exit(0);
}

const RETRY_STATUS = new Set([429, 503]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 服务端对整集生成有单用户每分钟上限（`podcastEpisodePerMinute`）。
// 预生成是批量跑，撞上限是预期内的，等一分钟重试即可，不必让整批失败。
// 503 也重试：上游网关偶发的失败靠一次重试通常就过去。
async function generate(episode) {
  const lines = episodeSourceLines(episode);
  const speakers = episodeSpeakers(episode);
  const request = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      episode_id: episode.id,
      source_hash: podcastSourceHash(lines),
      title: episode.title,
      turns: lines.map((text, index) => ({ speaker: speakers[index], text })),
    }),
  };
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${base}/api/rehearse/podcast/translations/generate`, request);
    const body = await response.json().catch(() => null);
    if (response.ok) return body.data;
    if (RETRY_STATUS.has(response.status) && attempt < 6) {
      const wait = response.status === 429 ? 60_000 : 5_000 * attempt;
      console.log(`   retry in ${Math.round(wait / 1000)}s (${response.status})`);
      await sleep(wait);
      continue;
    }
    throw new Error(body?.error?.message || `HTTP ${response.status}`);
  }
}

let ready = 0;
let generated = 0;
const failed = [];
for (const [index, episode] of episodes.entries()) {
  const label = `${String(index + 1).padStart(3)}/${episodes.length}`;
  try {
    const out = await generate(episode);
    if (out.cached) ready += 1;
    else generated += 1;
    console.log(
      `${label} ${out.cached ? 'cached   ' : 'generated'} ${episode.id} turns=${out.translations.length}`
    );
  } catch (error) {
    failed.push({ id: episode.id, message: error.message });
    console.log(`${label} FAILED    ${episode.id} ${error.message}`);
  }
}

console.log(`\ndone: generated=${generated} cached=${ready} failed=${failed.length}`);
if (failed.length > 0) {
  for (const item of failed) console.log(`  ${item.id}: ${item.message}`);
  process.exit(1);
}
