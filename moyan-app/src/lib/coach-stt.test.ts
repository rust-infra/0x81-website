import test from 'node:test';
import assert from 'node:assert/strict';
import { createSttAdapter, sttLocaleFor, type SpeechModuleLike } from './coach-stt';

function fakeModule() {
  const options: unknown[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const module: SpeechModuleLike = {
    requestPermissionsAsync: async () => ({ granted: true }),
    start: (value) => options.push(value),
    stop: () => {},
    abort: () => {},
    addListener: (event, listener) => {
      listeners.set(event, listener);
      return { remove: () => listeners.delete(event) };
    },
  };
  return { module, options, listeners };
}

test('starts recognition with the required native options', async () => {
  const fake = fakeModule();
  const adapter = createSttAdapter(fake.module);
  await adapter.start('en-US', {
    onInterim: () => {},
    onFinal: () => {},
    onVolume: () => {},
    onError: () => {},
    onEnd: () => {},
  });
  assert.deepEqual(fake.options[0], {
    lang: 'en-US',
    interimResults: true,
    continuous: false,
    addsPunctuation: true,
    requiresOnDeviceRecognition: false,
    volumeChangeEventOptions: { enabled: true, intervalMillis: 200 },
    iosCategory: {
      category: 'playAndRecord',
      categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
      mode: 'measurement',
    },
    recordingOptions: { persist: false },
  });
});

test('forwards interim, final and volume events', async () => {
  const fake = fakeModule();
  const interim: string[] = [];
  const final: string[] = [];
  const volumes: number[] = [];
  const adapter = createSttAdapter(fake.module);
  await adapter.start('en-GB', {
    onInterim: (text) => interim.push(text),
    onFinal: (text) => final.push(text),
    onVolume: (value) => volumes.push(value),
    onError: () => {},
    onEnd: () => {},
  });

  fake.listeners.get('result')?.({
    isFinal: false,
    results: [{ transcript: 'hello' }],
  });
  fake.listeners.get('result')?.({
    isFinal: true,
    results: [{ transcript: 'hello world' }],
  });
  fake.listeners.get('volumechange')?.({ value: 4.5 });

  assert.deepEqual(interim, ['hello']);
  assert.deepEqual(final, ['hello world']);
  assert.deepEqual(volumes, [4.5]);
});

test('reports permission denial without starting', async () => {
  const fake = fakeModule();
  fake.module.requestPermissionsAsync = async () => ({
    granted: false,
    canAskAgain: false,
  });
  const adapter = createSttAdapter(fake.module);
  await assert.rejects(
    () =>
      adapter.start('en-US', {
        onInterim: () => {},
        onFinal: () => {},
        onVolume: () => {},
        onError: () => {},
        onEnd: () => {},
      }),
    /permission-denied/
  );
  assert.equal(fake.options.length, 0);
});

test('maps UI and Chinese-accent locales to supported STT locales', () => {
  assert.equal(sttLocaleFor('en-IN'), 'en-IN');
  assert.equal(sttLocaleFor('en-GB'), 'en-GB');
  assert.equal(sttLocaleFor('zh-CN'), 'en-US');
  assert.equal(sttLocaleFor('en'), 'en-US');
});
