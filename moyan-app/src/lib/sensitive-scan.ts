export type SensitiveKind = 'phone' | 'email' | 'id';

export interface SensitiveHit {
  kind: SensitiveKind;
  value: string;
  start: number;
  end: number;
}

const PATTERNS: Array<{ kind: SensitiveKind; regex: RegExp }> = [
  { kind: 'phone', regex: /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d[-\s]?\d{4}[-\s]?\d{4}(?!\d)/g },
  { kind: 'email', regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { kind: 'id', regex: /(?<!\d)\d{17}[\dXx](?!\d)/g },
];

export function scanSensitive(text: string): SensitiveHit[] {
  const hits: SensitiveHit[] = [];
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    for (const match of text.matchAll(pattern.regex)) {
      const value = match[0];
      const start = match.index ?? 0;
      if (!hits.some((hit) => start < hit.end && start + value.length > hit.start)) {
        hits.push({ kind: pattern.kind, value, start, end: start + value.length });
      }
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

export function removeSensitiveHits(text: string, hits: SensitiveHit[]): string {
  let next = text;
  for (const hit of [...hits].sort((a, b) => b.start - a.start)) {
    next = next.slice(0, hit.start) + next.slice(hit.end);
  }
  return next;
}
