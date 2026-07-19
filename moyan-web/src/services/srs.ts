import type { SRSData } from '../db';

// SM-2 间隔重复算法
export function calculateSRS(srs: SRSData, rating: 'again' | 'hard' | 'good' | 'easy'): SRSData {
  const result = { ...srs };
  const oldEaseFactor = result.easeFactor;
  const oldInterval = result.interval;

  switch (rating) {
    case 'again':
      // 完全忘记，重置间隔
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

  // 设置下次复习日期
  const now = new Date();
  result.dueDate = new Date(now.getTime() + result.interval * 24 * 60 * 60 * 1000);
  result.lastReviewed = now;

  return result;
}

// 获取评分对应的预计下次复习时间描述
export function getIntervalPreview(srs: SRSData, rating: 'again' | 'hard' | 'good' | 'easy'): string {
  const temp = calculateSRS({ ...srs }, rating);
  const days = temp.interval;
  if (days === 0) return '< 1天';
  if (days === 1) return '1天';
  if (days < 30) return `${days}天`;
  if (days < 365) return `${Math.round(days / 30)}个月`;
  return `${(days / 365).toFixed(1)}年`;
}
