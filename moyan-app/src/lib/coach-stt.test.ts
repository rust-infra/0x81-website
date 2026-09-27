import test from 'node:test';
import assert from 'node:assert/strict';
import { createSttAdapter, type SpeechModuleLike } from './coach-stt';

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
