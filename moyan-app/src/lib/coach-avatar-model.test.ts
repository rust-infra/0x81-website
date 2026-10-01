import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarMotion } from './coach-avatar-model';

test('speaking and listening use bounded motion', () => {
  assert.equal(avatarMotion('speaking', false).animated, true);
  assert.equal(avatarMotion('listening', false).animated, true);
  assert.equal(avatarMotion('idle', false).breathing, true);
});

test('reduce motion keeps the same expression without loops', () => {
  for (const state of ['idle', 'listening', 'thinking', 'speaking'] as const) {
    const motion = avatarMotion(state, true);
    assert.equal(motion.animated, false);
    assert.equal(motion.breathing, false);
  }
});

test('unknown mood falls back to neutral', () => {
  assert.equal(avatarMotion('idle', false, 'sarcastic').mood, 'neutral');
});
