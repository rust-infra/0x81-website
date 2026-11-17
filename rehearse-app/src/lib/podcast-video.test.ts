import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ApiRequest } from './api-client';
import {
  createPodcastClipApi,
  loadPodcastPoster,
  resolvePodcastClipSource,
  type PodcastClipStatus,
} from './podcast-video';

test('podcast clip api posts text and reads status by key', async () => {
  const calls: Array<{ path: string; options?: RequestInit }> = [];
  const request = (async (path: string, options?: RequestInit) => {
    calls.push({ path, options });
    return path.endsWith('/clips')
      ? ({ key: 'abc', status: 'queued' } as PodcastClipStatus)
      : ({ key: 'abc', status: 'ready', url: '/api/rehearse/podcast/clips/abc/video' } as PodcastClipStatus);
  }) as ApiRequest;

  const api = createPodcastClipApi(request);
  const created = await api.request('Hello there.');
  assert.equal(created.status, 'queued');
  assert.equal(calls[0]!.path, '/api/rehearse/podcast/clips');
  assert.equal(calls[0]!.options?.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0]!.options?.body as string), {
    text: 'Hello there.',
  });

  await api.request('Do not generate this.', { enqueue: false });
  assert.deepEqual(JSON.parse(calls[1]!.options?.body as string), {
    text: 'Do not generate this.',
    enqueue: false,
  });

  const status = await api.status('abc');
  assert.equal(status.status, 'ready');
  assert.equal(calls[2]!.path, '/api/rehearse/podcast/clips/abc');
});

test('podcast video source needs a ready clip and a token', () => {
  assert.equal(
    resolvePodcastClipSource(
      { key: 'abc', status: 'queued' },
      'token',
      'http://localhost:4324'
    ),
    null
  );
  assert.equal(
    resolvePodcastClipSource(
      { key: 'abc', status: 'ready', url: '/api/rehearse/podcast/clips/abc/video' },
      null,
      'http://localhost:4324'
    ),
    null
  );
  assert.deepEqual(
    resolvePodcastClipSource(
      { key: 'abc', status: 'ready', url: '/api/rehearse/podcast/clips/abc/video' },
      'token',
      'http://localhost:4324'
    ),
    {
      uri: 'http://localhost:4324/api/rehearse/podcast/clips/abc/video',
      headers: { Authorization: 'Bearer token' },
    }
  );
});

test('podcast poster fetch carries the token and stays null without one', async () => {
  assert.equal(await loadPodcastPoster(null, 'http://localhost:4324'), null);

  const original = globalThis.FileReader;
  class FakeFileReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    readAsDataURL() {
      this.result = 'data:image/jpeg;base64,AAAA';
      this.onload?.();
    }
  }
  globalThis.FileReader = FakeFileReader as unknown as typeof FileReader;
  try {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        blob: async () => ({} as Blob),
      } as Response;
    }) as typeof fetch;

    const poster = await loadPodcastPoster(
      'token',
      'http://localhost:4324',
      fetchImpl
    );
    assert.equal(poster, 'data:image/jpeg;base64,AAAA');
    assert.equal(calls[0]!.url, 'http://localhost:4324/api/rehearse/podcast/poster');
    assert.deepEqual(calls[0]!.init?.headers, {
      Authorization: 'Bearer token',
    });
  } finally {
    globalThis.FileReader = original;
  }
});
