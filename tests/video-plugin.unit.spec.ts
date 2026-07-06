import { describe, expect, test } from 'vitest';

import { normalizeVideoBlocks } from '../src/plugins/video/video';
import { DEFAULT_VIDEO_CONFIG, normalizeVideoUrl, readVideoConfig } from '../src/plugins/video/video-model';
import type { VisualDocument } from '../src/types';

describe('video plugin URL normalization', () => {
  test('defaults new video blocks to an empty URL', () => {
    expect(DEFAULT_VIDEO_CONFIG.url).toBe('');
    expect(readVideoConfig({})).toEqual({ url: '', title: '' });
  });

  test('normalizes YouTube URLs and drops behavior query parameters', () => {
    const before = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&autoplay=1&start=90';
    const expectedResult = normalizeVideoUrl(before);

    expect(expectedResult).toMatchObject({
      provider: 'youtube',
      id: 'dQw4w9WgXcQ',
      canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&enablejsapi=1',
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    });
  });

  test('normalizes short YouTube, Vimeo, and Wistia URLs to canonical page URLs', () => {
    expect(normalizeVideoUrl('https://youtu.be/dQw4w9WgXcQ?si=ignored')?.canonicalUrl)
      .toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(normalizeVideoUrl('https://youtube.com/shorts/iuPWDMY0Li4?si=DBTDE-n5gxAmmB6O')?.canonicalUrl)
      .toBe('https://www.youtube.com/watch?v=iuPWDMY0Li4');
    expect(normalizeVideoUrl('https://youtube.com/shorts/iuPWDMY0Li4?si=DBTDE-n5gxAmmB6O')?.embedUrl)
      .toBe('https://www.youtube.com/embed/iuPWDMY0Li4?rel=0&enablejsapi=1');
    expect(normalizeVideoUrl('https://player.vimeo.com/video/123456789?autoplay=1')?.canonicalUrl)
      .toBe('https://vimeo.com/123456789');
    expect(normalizeVideoUrl('https://fast.wistia.net/embed/iframe/abc123def4?autoPlay=true')?.canonicalUrl)
      .toBe('https://wistia.com/medias/abc123def4');
  });

  test('rejects unsupported or non-HTTPS URLs', () => {
    expect(normalizeVideoUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(normalizeVideoUrl('https://example.invalid/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(normalizeVideoUrl('not a url')).toBeNull();
  });

  test('readVideoConfig stores normalized URL while preserving title', () => {
    const expectedResult = readVideoConfig({
      url: 'https://vimeo.com/123456789?autoplay=1',
      title: 'Demo',
    });

    expect(expectedResult).toEqual({
      url: 'https://vimeo.com/123456789',
      title: 'Demo',
    });
  });

  test('normalizes installed video plugin blocks in document hooks', () => {
    const document = {
      meta: {},
      extension: '.hvy' as const,
      attachments: [],
      sections: [{
        key: 'main',
        blocks: [{
          id: 'video',
          text: '',
          schemaMode: true,
          schema: {
            component: 'plugin',
            kind: 'plugin',
            plugin: 'hvy.video',
            pluginConfig: {
              url: 'https://player.vimeo.com/video/123456789?autoplay=1',
              title: 'Demo',
            },
          },
        }],
        children: [],
      }],
    };

    const expectedResult = normalizeVideoBlocks(document as unknown as VisualDocument);

    expect(expectedResult).toBe(true);
    expect(document.sections[0]?.blocks[0]?.schema.pluginConfig.url).toBe('https://vimeo.com/123456789');
  });

});
