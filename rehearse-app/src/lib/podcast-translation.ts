const cache = new Map<string, string>();

export function getCachedPodcastTranslation(key: string): string | undefined {
  return cache.get(key);
}

export async function translatePodcastLines(
  lines: Array<{ key: string; text: string }>,
  translate: (text: string) => Promise<string>,
  onResult: (key: string, text: string) => void,
  concurrency = 3
): Promise<void> {
  const queue = [...lines];
  const worker = async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      try {
        const text = (await translate(item.text)).trim();
        if (!text) continue;
        cache.set(item.key, text);
        onResult(item.key, text);
      } catch {
        // 单句翻译失败时保留原文，不阻塞其他句子。
      }
    }
  };
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, queue.length)) },
    worker
  );
  await Promise.all(workers);
}
