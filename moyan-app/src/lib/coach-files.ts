export interface PickedImage {
  uri: string;
  fileName?: string | null;
  width: number;
  height: number;
  size?: number | null;
}

export interface PreparedImage extends PickedImage {
  mediaType: 'image/jpeg';
}

export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 4 * 1024 * 1024;

export function resizeActionFor(
  width: number,
  height: number,
  maxLongEdge = 1600
): { width?: number; height?: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) return {};
  return width >= height
    ? { width: maxLongEdge }
    : { height: maxLongEdge };
}

export async function normalizePickedImages(
  images: PickedImage[]
): Promise<PreparedImage[]> {
  if (images.length === 0) throw new Error('at least one image is required');
  if (images.length > MAX_IMAGES) throw new Error(`max ${MAX_IMAGES} images`);
  let total = 0;
  for (const image of images) {
    if ((image.size ?? 0) > MAX_IMAGE_BYTES) {
      throw new Error('each image must be at most 1MB');
    }
    total += image.size ?? 0;
  }
  if (total > MAX_TOTAL_IMAGE_BYTES) throw new Error('images must total at most 4MB');
  return images.map((image) => ({ ...image, mediaType: 'image/jpeg' }));
}

export async function withCleanup<T>(
  files: PickedImage[],
  operation: () => Promise<T>,
  remove: (files: PickedImage[]) => Promise<void>
): Promise<T> {
  try {
    return await operation();
  } finally {
    await remove(files);
  }
}

export interface PreparedDocument {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
  file?: File;
}

export function buildInterviewForm(input: {
  docs?: PreparedDocument[];
  images?: PreparedImage[];
}): FormData {
  const form = new FormData();
  for (const image of input.images ?? []) {
    form.append(
      'images',
      {
        uri: image.uri,
        name: image.fileName || 'resume.jpg',
        type: 'image/jpeg',
      } as unknown as Blob
    );
  }
  for (const doc of input.docs ?? []) {
    form.append(
      'docs',
      (doc.file ??
        ({
          uri: doc.uri,
          name: doc.name,
          type: doc.mimeType || 'application/octet-stream',
        } as unknown as Blob))
    );
  }
  return form;
}
