import test from 'node:test';
import assert from 'node:assert/strict';
import { applySyncedSettings, buildSyncedSettings } from './rehearse-sync';
import type { SyncedUserSettings } from './rehearse-types';
import type { SpeechSettings } from './speech';

const localSpeech: SpeechSettings = {
  provider: 'elevenlabs',
  sttProvider: 'gemini',
  speech_voice: 'en-US-Neural2-D',
  speech_zh_voice: 'cmn-CN-Neural2-D',
  speech_speed: 0.9,
  auto_play: true,
  cacheEnabled: true,
  googleKey: 'google-secret',
  elevenLabsKey: 'eleven-secret',
  aliyunKey: 'aliyun-secret',
  googleCloudServiceAccountJson: '{"type":"service_account"}',
  geminiApiKey: 'gemini-secret',
};

test('buildSyncedSettings never uploads credentials', () => {
  const doc = buildSyncedSettings('dark', 'en', localSpeech);
  assert.equal(doc.theme, 'dark');
  assert.equal(doc.language, 'en');
  assert.equal(doc.speech?.provider, 'elevenlabs');
  assert.equal(doc.speech?.speech_speed, 0.9);

  const uploaded = JSON.stringify(doc);
  for (const secret of [
    'google-secret',
    'eleven-secret',
    'aliyun-secret',
    'service_account',
    'gemini-secret',
  ]) {
    assert.ok(!uploaded.includes(secret), `文档里不该出现凭据 ${secret}`);
  }
});

test('applySyncedSettings keeps local credentials and takes remote preferences', () => {
  const merged = applySyncedSettings(
    {
      theme: 'light',
      language: 'zh-CN',
      speech: { provider: 'webspeech', speech_speed: 1.2, auto_play: false },
    },
    localSpeech
  );
  assert.equal(merged.provider, 'webspeech');
  assert.equal(merged.speech_speed, 1.2);
  assert.equal(merged.auto_play, false);
  // 本机凭据不被空文档抹掉，也不被远端（非法）值覆盖
  const kept = JSON.stringify(merged);
  assert.ok(kept.includes('google-secret'), 'google 凭据应当保留');
  assert.ok(kept.includes('eleven-secret'), 'elevenlabs 凭据应当保留');
});

test('applySyncedSettings ignores credentials that a remote document tries to set', () => {
  const merged = applySyncedSettings(
    {
      speech: { provider: 'google', googleKey: 'remote-key' } as SpeechSettings,
    },
    localSpeech
  );
  assert.equal(merged.googleKey, 'google-secret');
});

test('applySyncedSettings ignores prototype-polluting keys from a remote document', () => {
  const remote = JSON.parse('{"speech":{"__proto__":{"polluted":true},"provider":"webspeech"}}');
  const merged = applySyncedSettings(remote as SyncedUserSettings, localSpeech);
  assert.equal(merged.provider, 'webspeech');
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  assert.ok(!JSON.stringify(merged).includes('polluted'));
});
