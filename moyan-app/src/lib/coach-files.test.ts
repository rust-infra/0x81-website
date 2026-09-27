import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInterviewForm,
  normalizePickedImages,
  resizeActionFor,
  withCleanup,
} from './coach-files';

const image = (id: string, width = 1200, height = 800, size = 100_000) => ({
  uri: `file:///${id}.jpg`,
  fileName: `${id}.jpg`,
  width,
  height,
  size,
});

test('rejects more than five images before upload', async () => {
  await assert.rejects(
    () => normalizePickedImages(Array.from({ length: 6 }, (_, index) => image(String(index)))),
    /max 5 images/
  );
});

test('computes a long-edge resize without upscaling', () => {
  assert.deepEqual(resizeActionFor(3000, 2000, 1600), { width: 1600 });
  assert.deepEqual(resizeActionFor(1200, 800, 1600), {});
});

test('deletes local files even when upload fails', async () => {
  const removed: string[][] = [];
  await assert.rejects(
    () =>
      withCleanup(
        [image('a')],
        () => Promise.reject(new Error('upload failed')),
        async (items) => {
          removed.push(items.map((item) => item.uri));
        }
      ),
    /upload failed/
  );
  assert.deepEqual(removed, [['file:///a.jpg']]);
});

test('builds native image multipart parts from blobs', () => {
  const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
  const form = buildInterviewForm({
    images: [{ ...image('resume'), mediaType: 'image/jpeg', file }],
  });
  assert.ok(form.get('images') instanceof Blob);
});
