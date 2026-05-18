import { describe, expect, test } from 'vitest';

import {
  calculateContainedImageDimensions,
  prepareImageAttachmentBytes,
  resolveImageAttachmentMaxDimensions,
  isAllowedImageAttachmentMediaType,
  type ImageAttachmentResizeAdapter,
} from '../src/image-attachments';

describe('image attachment resizing', () => {
  test('expected result: default max dimensions cap large uploads', () => {
    expect(resolveImageAttachmentMaxDimensions(undefined)).toEqual({ width: 2048, height: 2048 });
  });

  test('expected result: null disables attachment resizing', () => {
    expect(resolveImageAttachmentMaxDimensions(null)).toBeNull();
  });

  test('expected result: target dimensions preserve aspect ratio', () => {
    expect(calculateContainedImageDimensions({ width: 4000, height: 3000 }, { width: 1600, height: 1200 })).toEqual({
      width: 1600,
      height: 1200,
      resized: true,
    });

    expect(calculateContainedImageDimensions({ width: 1200, height: 900 }, { width: 1600, height: 1200 })).toEqual({
      width: 1200,
      height: 900,
      resized: false,
    });
  });

  test('before, resize adapter call, after: oversized jpeg is stored at bounded dimensions', async () => {
    const before = new File([new Uint8Array([1, 2, 3, 4])], 'photo.jpg', { type: 'image/jpeg' });
    const adapter: ImageAttachmentResizeAdapter = {
      getDimensions: async () => ({ width: 4000, height: 3000 }),
      resize: async (_file, options) => new Uint8Array([options.width / 100, options.height / 100]),
    };

    const expectedResult = await prepareImageAttachmentBytes(before, 'image/jpeg', { width: 1600, height: 1200 }, adapter);

    expect(Array.from(expectedResult.bytes)).toEqual([16, 12]);
    expect(expectedResult.mediaType).toBe('image/jpeg');
  });

  test('expected result: gif is not an allowed attachment image type', () => {
    expect(isAllowedImageAttachmentMediaType('image/gif')).toBe(false);
    expect(isAllowedImageAttachmentMediaType('image/jpeg')).toBe(true);
  });

  test('before, prepare call, after: gif upload is rejected', async () => {
    const before = new File([new Uint8Array([5, 6, 7])], 'animation.gif', { type: 'image/gif' });

    await expect(prepareImageAttachmentBytes(before, 'image/gif', { width: 16, height: 16 })).rejects.toThrow(
      'Unsupported image attachment type: image/gif'
    );
  });
});
