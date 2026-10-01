import test from 'node:test';
import assert from 'node:assert/strict';
import { bytesToBase64, sttMimeTypeForUri } from './coach-recorder';

test('maps recorded file extensions to Gemini-supported audio MIME types', () => {
  assert.equal(sttMimeTypeForUri('file:///tmp/recording.m4a'), 'audio/m4a');
  assert.equal(sttMimeTypeForUri('file:///tmp/recording.wav'), 'audio/wav');
  assert.equal(sttMimeTypeForUri('file:///tmp/recording.webm'), 'audio/webm');
  assert.equal(sttMimeTypeForUri('file:///tmp/recording.3gp'), 'audio/3gpp');
  assert.equal(sttMimeTypeForUri('file:///tmp/recording.unknown'), 'audio/m4a');
});

test('converts recorded bytes to base64 in chunks', () => {
  const bytes = new Uint8Array([65, 66, 67, 68]);
  assert.equal(bytesToBase64(bytes), 'QUJDRA==');
});
