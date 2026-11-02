import test from 'node:test';
import assert from 'node:assert/strict';
import { createSttAdapter, sttLocaleFor, type SpeechModuleLike } from './rehearse-stt';

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
  await adapter.start(
    'en-US',
    {
      onInterim: () => {},
      onFinal: () => {},
      onVolume: () => {},
      onError: () => {},
      onEnd: () => {},
    },
    ['API', 'rollback']
  );
  assert.deepEqual(fake.options[0], {
    lang: 'en-US',
    interimResults: true,
    continuous: false,
    addsPunctuation: true,
    requiresOnDeviceRecognition: false,
    maxAlternatives: 1,
    contextualStrings: ['API', 'rollback'],
    iosTaskHint: 'dictation',
    volumeChangeEventOptions: { enabled: true, intervalMillis: 200 },
    iosCategory: {
      category: 'playAndRecord',
      categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
      mode: 'voiceChat',
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
  fake.listeners.get('volumechange')?.({ value: 4.5 });
  fake.listeners.get('result')?.({
    isFinal: true,
    results: [{ transcript: 'hello world' }],
  });

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

test('final result removes native listeners and prevents a late end callback', async () => {
  const fake = fakeModule();
  const finals: string[] = [];
  const ends: string[] = [];
  const adapter = createSttAdapter(fake.module);
  await adapter.start('en-US', {
    onInterim: () => {},
    onFinal: (text) => finals.push(text),
    onVolume: () => {},
    onError: () => {},
    onEnd: () => ends.push('end'),
  });

  const lateEnd = fake.listeners.get('end');
  fake.listeners.get('result')?.({
    isFinal: true,
    results: [{ transcript: 'hello world' }],
  });
  lateEnd?.({});

  assert.deepEqual(finals, ['hello world']);
  assert.equal(fake.listeners.size, 0);
  assert.deepEqual(ends, []);
});

test('error removes native listeners and aborts the recognition session', async () => {
  const fake = fakeModule();
  let aborted = 0;
  fake.module.abort = () => {
    aborted += 1;
  };
  const errors: string[] = [];
  const adapter = createSttAdapter(fake.module);
  await adapter.start('en-US', {
    onInterim: () => {},
    onFinal: () => {},
    onVolume: () => {},
    onError: (message) => errors.push(message),
    onEnd: () => {},
  });

  fake.listeners.get('error')?.({ message: 'native failure', error: 'native' });

  assert.deepEqual(errors, ['native failure']);
  assert.equal(aborted, 1);
  assert.equal(fake.listeners.size, 0);
});

test('maps UI and Chinese-accent locales to supported STT locales', () => {
  assert.equal(sttLocaleFor('en-IN'), 'en-IN');
  assert.equal(sttLocaleFor('en-GB'), 'en-GB');
  assert.equal(sttLocaleFor('zh-CN'), 'en-US');
  assert.equal(sttLocaleFor('en'), 'en-US');
});

/**
 * 真实的 iOS 模块在 `stop()` **之后**才派发最终结果。若 stop 先把监听摘掉，
 * 这次结果就丢了——按住说话松开后消息发不出去，正是这个原因。
 */
function stopDeliversFinalModule() {
  const listeners = new Map<string, { alive: boolean; fn: (event: unknown) => void }>();
  const module: SpeechModuleLike = {
    requestPermissionsAsync: async () => ({ granted: true }),
    start: () => {},
    stop: () => {
      const result = listeners.get('result');
      if (result?.alive) {
        result.fn({ isFinal: true, results: [{ transcript: 'done speaking' }] });
      }
      const end = listeners.get('end');
      if (end?.alive) end.fn({});
    },
    abort: () => {},
    addListener: (event, listener) => {
      const entry = { alive: true, fn: listener };
      listeners.set(event, entry);
      return {
        remove: () => {
          entry.alive = false;
        },
      };
    },
  };
  return module;
}

test('stop keeps listening long enough to deliver the final transcript', async () => {
  const module = stopDeliversFinalModule();
  const finals: string[] = [];
  const adapter = createSttAdapter(module);
  const session = await adapter.start('en-US', {
    onInterim: () => {},
    onFinal: (text) => finals.push(text),
    onVolume: () => {},
    onError: () => {},
    onEnd: () => {},
  });

  session.stop();
  assert.deepEqual(finals, ['done speaking'], 'stop() 之后到达的最终结果必须被送达');
});

test('abort drops the transcript instead of delivering it', async () => {
  const module = stopDeliversFinalModule();
  const finals: string[] = [];
  const adapter = createSttAdapter(module);
  const session = await adapter.start('en-US', {
    onInterim: () => {},
    onFinal: (text) => finals.push(text),
    onVolume: () => {},
    onError: () => {},
    onEnd: () => {},
  });

  session.abort();
  assert.deepEqual(finals, [], 'abort() 不应把结果送上来');
});
