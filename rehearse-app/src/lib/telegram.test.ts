import test from 'node:test';
import assert from 'node:assert/strict';
import { getTelegramInitData, getTelegramWebApp } from './telegram';

// 普通浏览器 / 原生 App 里没有 Telegram 对象：不能抛错，也不能把登录流程卡住。
test('returns empty outside Telegram', () => {
  assert.equal(getTelegramWebApp(null), null);
  assert.equal(getTelegramWebApp({}), null);
  assert.equal(getTelegramInitData({}), '');
});

// initData 是 Mini App 唯一的身份凭证；同时 ready/expand 各调用一次。
test('reads initData and completes the handshake', () => {
  let ready = 0;
  let expand = 0;
  const scope = {
    Telegram: {
      WebApp: {
        initData: 'query_id=1&hash=abc',
        ready: () => {
          ready += 1;
        },
        expand: () => {
          expand += 1;
        },
      },
    },
  };

  assert.equal(getTelegramInitData(scope), 'query_id=1&hash=abc');
  assert.equal(ready, 1);
  assert.equal(expand, 1);
});

// 旧版 SDK / 非 Telegram 注入的对象可能没有 initData 或方法。
test('tolerates a WebApp object without initData or methods', () => {
  assert.equal(getTelegramInitData({ Telegram: { WebApp: {} } }), '');
  assert.equal(getTelegramInitData({ Telegram: { WebApp: { initData: 42 } } }), '');
});

// 握手抛错不能把登录流程带走；initData 仍然要返回。
test('swallows handshake errors', () => {
  const scope = {
    Telegram: {
      WebApp: {
        initData: 'query_id=1&hash=abc',
        ready: () => {
          throw new Error('nope');
        },
      },
    },
  };

  assert.equal(getTelegramInitData(scope), 'query_id=1&hash=abc');
});
