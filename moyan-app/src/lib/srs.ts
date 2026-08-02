// SM-2 间隔重复算法（与 moyan-web 一致）
import type { SRSData } from './types';

export function calculateSRS(
  srs: SRSData,
  rating: 'again' | 'hard' | 'good' | 'easy'
): SRSData {
  const result = { ...srs };
  const oldEaseFactor = result.easeFactor;
  const oldInterval = result.interval;

  switch (rating) {
    case 'again':
      result.repetitions = 0;
      result.interval = 1;
      result.easeFactor = Math.max(1.3, oldEaseFactor - 0.2);
      result.status = 'relearning';
      break;

    case 'hard':
      result.repetitions += 1;
      if (result.repetitions === 1) {
        result.interval = 1;
      } else if (result.repetitions === 2) {
        result.interval = 3;
      } else {
        result.interval = Math.round(oldInterval * 1.2);
      }
      result.easeFactor = Math.max(1.3, oldEaseFactor - 0.15);
      result.status = 'review';
      break;

    case 'good':
      result.repetitions += 1;
      if (result.repetitions === 1) {
        result.interval = 1;
      } else if (result.repetitions === 2) {
        result.interval = 3;
      } else {
        result.interval = Math.round(oldInterval * oldEaseFactor);
      }
      result.status = 'review';
      break;

    case 'easy':
      result.repetitions += 1;
      if (result.repetitions === 1) {
        result.interval = 3;
      } else if (result.repetitions === 2) {
        result.interval = 5;
      } else {
        result.interval = Math.round(oldInterval * oldEaseFactor * 1.3);
      }
      result.easeFactor = oldEaseFactor + 0.15;
      result.status = 'review';
      break;
  }

  const now = new Date();
  result.dueDate = new Date(now.getTime() + result.interval * 24 * 60 * 60 * 1000);
  result.lastReviewed = now;
  return result;
}

export function defaultSrs(): SRSData {
  return {
    interval: 0,
    repetitions: 0,
    easeFactor: 2.5,
    dueDate: new Date(),
    status: 'new',
  };
}

export function progressToSrs(progress: {
  interval: number;
  repetitions: number;
  ease_factor: number;
  due_date: string;
  last_reviewed_at?: string | null;
  srs_status: string;
} | null): SRSData {
  if (!progress) return defaultSrs();
  return {
    interval: progress.interval,
    repetitions: progress.repetitions,
    easeFactor: progress.ease_factor,
    dueDate: new Date(progress.due_date),
    lastReviewed: progress.last_reviewed_at
      ? new Date(progress.last_reviewed_at)
      : undefined,
    status: (progress.srs_status as SRSData['status']) || 'new',
  };
}
