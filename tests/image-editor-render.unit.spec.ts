import { describe, expect, test } from 'vitest';

import { renderCarouselEditor } from '../src/editor/components/carousel/carousel';
import { renderImageEditor } from '../src/editor/components/image/image';
import { createEmptyBlock, createEmptySection } from '../src/document-factory';
import { initState } from '../src/state';
import { escapeAttr, escapeHtml } from '../src/utils';
import type { VisualBlock } from '../src/editor/types';
import { createTestState } from './serialization-test-helpers';

const helpers = {
  escapeAttr,
  escapeHtml,
  renderComponentFragment: () => '',
  renderEditorBlock: () => '',
  renderPassiveEditorBlock: () => '',
  renderComponentOptions: () => '',
  renderBlockMetaFields: () => '',
  renderComponentPlacementTarget: () => '',
};

describe('image editor render controls', () => {
  test('expected result: image editor offers camera capture and attached picture reuse', () => {
    const block: VisualBlock = createEmptyBlock('image');
    block.id = 'photo';
    block.schema.imageFile = 'avatar.jpg';
    block.schema.imageAlt = 'Avatar';
    const section = createEmptySection(1);
    section.key = 'profile';
    section.title = 'Profile';
    section.blocks = [block];
    initState(createTestState({
      meta: {},
      extension: '.hvy',
      sections: [section],
      attachments: [
        { id: 'image:avatar.jpg', meta: { mediaType: 'image/jpeg' }, bytes: new Uint8Array([1, 2, 3]) },
        { id: 'image:unused.jpg', meta: { mediaType: 'image/jpeg' }, bytes: new Uint8Array([4, 5, 6]) },
      ],
    }));

    const expectedResult = renderImageEditor('profile', block, helpers);

    expect(expectedResult).toContain('data-action="image-take-photo"');
    expect(expectedResult).toContain('data-action="image-use-existing"');
    expect(expectedResult).toContain('data-image-filename="avatar.jpg"');
    expect(expectedResult).toContain('data-action="image-delete-current"');
    expect(expectedResult).toContain('data-action="image-delete-unused"');
    expect(expectedResult).toContain('data-image-filename="unused.jpg"');
    expect(expectedResult).not.toContain('aria-label="Delete unused image avatar.jpg"');
    expect(expectedResult).toContain('download="avatar.jpg"');
  });

  test('expected result: carousel editor offers camera capture and attached picture duplication', () => {
    const block: VisualBlock = createEmptyBlock('carousel');
    block.id = 'carousel';
    block.schema.carouselImages = [{ imageFile: 'slide.jpg', imageAlt: 'Slide', caption: '' }];
    const section = createEmptySection(1);
    section.key = 'gallery';
    section.title = 'Gallery';
    section.blocks = [block];
    initState(createTestState({
      meta: {},
      extension: '.hvy',
      sections: [section],
      attachments: [
        { id: 'image:slide.jpg', meta: { mediaType: 'image/jpeg' }, bytes: new Uint8Array([1, 2, 3]) },
      ],
    }));

    const expectedResult = renderCarouselEditor('gallery', block, helpers);

    expect(expectedResult).toContain('data-action="carousel-take-photo"');
    expect(expectedResult).toContain('data-action="carousel-add-existing"');
    expect(expectedResult).toContain('data-image-filename="slide.jpg"');
    expect(expectedResult).toContain('download="slide.jpg"');
    expect(expectedResult).toContain('data-action="carousel-delete-image"');
  });
});
