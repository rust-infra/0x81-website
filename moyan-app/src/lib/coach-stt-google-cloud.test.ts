import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleCloudSttRequest,
  parseGoogleCloudSttResponse,
  parseGoogleServiceAccount,
  transcribeWithGoogleCloud,
} from './coach-stt-google-cloud';

const serviceAccount = JSON.stringify({
  type: 'service_account',
  project_id: 'moyan-dev',
  private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
  client_email: 'stt@moyan-dev.iam.gserviceaccount.com',
  token_uri: 'https://oauth2.googleapis.com/token',
});

test('parses a Google service account and derives its project', () => {
  const account = parseGoogleServiceAccount(serviceAccount);
  assert.equal(account.project_id, 'moyan-dev');
  assert.equal(account.client_email, 'stt@moyan-dev.iam.gserviceaccount.com');
  assert.throws(() => parseGoogleServiceAccount('{broken'), /valid JSON/);
});

test('builds a Cloud STT V2 recognize request', () => {
  const request = buildGoogleCloudSttRequest(
    { audioBase64: 'QUJD', mimeType: 'audio/m4a', languageCode: 'en-US' },
    'chirp_3'
  );
  assert.deepEqual(request.config.autoDecodingConfig, {});
  assert.deepEqual(request.config.languageCodes, ['en-US']);
  assert.equal(request.config.model, 'chirp_3');
  assert.equal(request.config.features.enableAutomaticPunctuation, true);
  assert.equal(request.content, 'QUJD');
});

test('parses Cloud STT alternatives in order', () => {
  const result = parseGoogleCloudSttResponse({
    results: [
      { alternatives: [{ transcript: 'Hello', confidence: 0.9 }] },
      { alternatives: [{ transcript: 'team.', confidence: 0.8 }] },
    ],
  });
  assert.deepEqual(result, { text: 'Hello team.', confidence: 0.8 });
  assert.equal(parseGoogleCloudSttResponse({ results: [] }), null);
});

test('exchanges a signed service-account JWT and calls Cloud STT V2', async () => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  let tokenForm = '';
  const result = await transcribeWithGoogleCloud(
    { audioBase64: 'QUJD', mimeType: 'audio/m4a', languageCode: 'en-US' },
    {
      serviceAccountJson: serviceAccount,
      location: 'us-central1',
      model: 'chirp_3',
    },
    {
      now: () => 1_700_000_000_000,
      signJwt: (header, payload, privateKey) => {
        assert.match(privateKey, /BEGIN PRIVATE KEY/);
        assert.equal(JSON.parse(header).alg, 'RS256');
        const claims = JSON.parse(payload);
        assert.equal(claims.iss, 'stt@moyan-dev.iam.gserviceaccount.com');
        return 'signed.jwt';
      },
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), options: options || {} });
        if (String(url).includes('oauth2.googleapis.com')) {
          tokenForm = String(options?.body || '');
          return new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({ results: [{ alternatives: [{ transcript: 'Hello team.' }] }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
    }
  );

  assert.equal(result.text, 'Hello team.');
  assert.equal(result.provider, 'google-cloud');
  assert.match(tokenForm, /assertion=signed.jwt/);
  assert.match(calls[1]?.url || '', /projects\/moyan-dev\/locations\/us-central1/);
  const headers = calls[1]?.options.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer access-token');
});
