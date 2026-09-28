import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeminiSttRequest,
  parseGeminiTranscript,
  transcribeWithGemini,
} from './coach-stt-cloud';

const input = {
  audioBase64: 'QUJD',
  mimeType: 'audio/m4a',
  languageCode: 'en-US',
  hints: ['API', 'rollback'],
};

test('builds a Gemini audio transcription request with a structured transcript', () => {
  const request = buildGeminiSttRequest(input, 'gemini-3.8-flash');
  assert.equal(request.model, 'gemini-3.8-flash');
  assert.equal(request.input[1].type, 'audio');
  assert.equal(request.input[1].data, 'QUJD');
  assert.equal(request.input[1].mime_type, 'audio/m4a');
  assert.equal(request.response_format.required[0], 'transcript');
  assert.match(request.input[0].text, /verbatim/i);
  assert.match(request.input[0].text, /en-US/);
  assert.match(request.input[0].text, /Relevant context/);
});

test('parses Gemini output_text JSON and legacy candidate responses', () => {
  assert.equal(
    parseGeminiTranscript({ output_text: '{"transcript":"We finished the API."}' }),
    'We finished the API.'
  );
  assert.equal(
    parseGeminiTranscript({ output_text: 'Plain transcript.' }),
    'Plain transcript.'
  );
  assert.equal(
    parseGeminiTranscript({
      candidates: [{ content: { parts: [{ text: 'Legacy transcript.' }] } }],
    }),
    'Legacy transcript.'
  );
  assert.equal(parseGeminiTranscript({ output_text: '   ' }), null);
});

test('calls Gemini with the user API key and returns the transcript', async () => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const result = await transcribeWithGemini(
    input,
    { apiKey: 'user-key', model: 'gemini-3.8-flash' },
    {
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), options: options || {} });
        return new Response(JSON.stringify({ output_text: '{"transcript":"Hello team."}' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    }
  );

  assert.equal(result.text, 'Hello team.');
  assert.equal(result.provider, 'gemini');
  assert.equal(calls[0]?.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  const headers = calls[0]?.options.headers as Record<string, string>;
  assert.equal(headers['x-goog-api-key'], 'user-key');
});

test('reports Gemini authentication failures without exposing the key', async () => {
  await assert.rejects(
    () =>
      transcribeWithGemini(
        input,
        { apiKey: 'secret-key', model: 'gemini-3.8-flash' },
        {
          fetchImpl: async () =>
            new Response(JSON.stringify({ error: { message: 'invalid key' } }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            }),
        }
      ),
    (error: Error) => error.message.includes('401') && !error.message.includes('secret-key')
  );
});
