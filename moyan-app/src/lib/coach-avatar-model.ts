import type { CoachMood } from './coach-types';

export type CoachAvatarState = 'idle' | 'listening' | 'thinking' | 'speaking';

const MOODS: CoachMood[] = [
  'neutral',
  'friendly',
  'curious',
  'encouraging',
  'concerned',
];

export interface AvatarMotion {
  mood: CoachMood;
  animated: boolean;
  breathing: boolean;
  pulse: boolean;
  dots: boolean;
  mouth: boolean;
}

export function avatarMotion(
  state: CoachAvatarState,
  reduceMotion: boolean,
  mood?: string
): AvatarMotion {
  const safeMood = MOODS.includes(mood as CoachMood)
    ? (mood as CoachMood)
    : 'neutral';
  return {
    mood: safeMood,
    animated: !reduceMotion,
    breathing: !reduceMotion && state === 'idle',
    pulse: !reduceMotion && state === 'listening',
    dots: !reduceMotion && state === 'thinking',
    mouth: !reduceMotion && state === 'speaking',
  };
}
