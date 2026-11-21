import generated from './podcast-translations.json';

/**
 * 预生成播客中文字幕（132 集 / 888 句）。
 *
 * 2026-11-22 离线生成，目的是让播放器不再依赖每集的 LLM key。
 * 机器译文可以在后续用人工校对或整集 LLM 重译后直接替换 JSON。
 */
const BUNDLED = generated as Record<string, string>;

export function bundledEpisodeTranslations(
  episodeId: string,
  turnCount: number
): Record<string, string> {
  const out: Record<string, string> = {};
  for (let index = 0; index < turnCount; index += 1) {
    const key = `${episodeId}:${index}`;
    const value = BUNDLED[key];
    if (value) out[key] = value;
  }
  return out;
}

export function bundledTranslationCount(): number {
  return Object.keys(BUNDLED).length;
}
