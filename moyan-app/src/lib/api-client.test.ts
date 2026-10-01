import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequestWithDeps } from './api-client';
import { ApiError } from './api-error';

test('apiRequestWithDeps returns the data envelope and sends bearer auth', async () => {
  let seenAuth = '';
  const value = await apiRequestWithDeps<{ remaining: number }>('/quota', {}, {
    baseUrl: 'http://example.test',
    getToken: async () => 'jwt',
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenAuth = String((init?.headers as Record<string, string>).Authorization);
      return new Response(
        JSON.stringify({ success: true, data: { remaining: 96 } }),
        { status: 200 }
      );
    }) as typeof fetch,
  });

  assert.equal(seenAuth, 'Bearer jwt');
  assert.equal(value.remaining, 96);
});

test('apiRequestWithDeps preserves structured 429 details', async () => {
  try {
    await apiRequestWithDeps('/turn', {}, {
      baseUrl: 'http://example.test',
      getToken: async () => 'jwt',
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: {
              code: 429,
              reason: 'coach_quota_exceeded',
              message: 'limited',
              limit: 2,
              used: 2,
            },
          }),
          { status: 429 }
        )) as typeof fetch,
    });
    assert.fail('expected ApiError');
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 429);
    assert.equal(error.reason, 'coach_quota_exceeded');
    assert.equal((error.details as { limit?: number }).limit, 2);
  }
});
