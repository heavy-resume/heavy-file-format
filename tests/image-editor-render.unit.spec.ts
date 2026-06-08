import { describe, expect, test, vi } from 'vitest';

import { getCarouselSlideScrollLeft, renderCarouselEditor, renderCarouselReader } from '../src/editor/components/carousel/carousel';
import { bindImageDragAndDrop, renderImageEditor } from '../src/editor/components/image/image';
import type { ComponentRenderHelpers } from '../src/editor/component-helpers';
import { createEmptyBlock, createEmptySection } from '../src/document-factory';
import { initState } from '../src/state';
import { escapeAttr, escapeHtml } from '../src/utils';
import type { VisualBlock } from '../src/editor/types';
import { createTestState } from './serialization-test-helpers';

const helpers: ComponentRenderHelpers = {
  escapeAttr,
  escapeHtml,
  markdownToEditorHtml: (markdown) => markdown,
  renderRichToolbar: () => '',
  renderComponentFragment: () => '',
  renderEditorBlock: () => '',
  renderPassiveEditorBlock: () => '',
  renderReaderBlock: () => '',
  renderReaderBlocks: () => '',
  renderReaderListBlocks: () => '',
  orderReaderBlocks: (blocks) => blocks,
  orderReaderListBlocks: (blocks) => blocks,
  isReaderViewPrioritizedBlock: () => false,
  renderComponentOptions: () => '',
  renderAddComponentPicker: () => '',
  renderComponentPlacementTarget: () => '',
  renderOption: (value) => value,
  getDocumentComponentCss: () => '',
  getXrefTargetOptions: () => [],
  isXrefTargetValid: () => true,
  getTableColumns: () => [],
  ensureContainerBlocks: () => {},
  ensureComponentListBlocks: () => {},
  getSelectedAddComponent: (_key, fallback) => fallback,
  getComponentListReaderViewId: () => '',
  getReaderContainerExpanded: (_key, fallback) => fallback,
  isExpandableEditorPanelOpen: (_sectionKey, _blockId, _panel, fallback) => fallback,
  isAdvancedEditorMode: () => false,
  isMobileAdjustmentMode: () => false,
};

describe('image editor render controls', () => {
  test('expected result: image editor offers camera capture and attached picture reuse', () => {
    const block: VisualBlock = createEmptyBlock('image');
    block.id = 'photo';
    block.schema.imageFile = 'avatar.jpg';
    block.schema.imageAlt = 'Avatar';
    block.schema.caption = 'Team photo';
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
    expect(expectedResult).toContain('data-field="image-caption"');
    expect(expectedResult).toContain('<figcaption class="image-caption">Team photo</figcaption>');
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
    expect(expectedResult).toContain('data-field="carousel-show-frame"');
    expect(expectedResult).toContain('data-image-filename="slide.jpg"');
    expect(expectedResult).toContain('download="slide.jpg"');
    expect(expectedResult).toContain('data-action="carousel-delete-image"');
  });

  test('expected result: carousel frame chrome can be hidden without removing the frame', () => {
    const block: VisualBlock = createEmptyBlock('carousel');
    block.schema.carouselImages = [{ imageFile: 'slide.jpg', imageAlt: 'Slide', caption: '' }];
    block.schema.carouselShowFrame = false;
    initState(createTestState({
      meta: {},
      extension: '.hvy',
      sections: [createEmptySection(1)],
      attachments: [
        { id: 'image:slide.jpg', meta: { mediaType: 'image/jpeg' }, bytes: new Uint8Array([1, 2, 3]) },
      ],
    }));

    const expectedResult = renderCarouselReader(createEmptySection(1), block, helpers);

    expect(expectedResult).toContain('class="hvy-carousel-reader-frame"');
    expect(expectedResult).not.toContain('hvy-carousel-reader-frame-chrome');
  });

  test('expected result: carousel navigation targets the actual slide position', () => {
    const track = {
      scrollLeft: 0,
      clientWidth: 600,
      getBoundingClientRect: () => ({ left: 0 }),
    } as HTMLElement;
    const slideTwentyFour = {
      getBoundingClientRect: () => ({ left: 14_421 }),
    } as HTMLElement;

    const expectedResult = getCarouselSlideScrollLeft(track, slideTwentyFour);

    expect(expectedResult).toBe(14_421);
    expect(expectedResult).not.toBe(23 * track.clientWidth);
  });

  test('before, repeated bind, after: image drag/drop listeners are registered once per app root', () => {
    const addEventListener = vi.fn();
    const app = { addEventListener } as unknown as HTMLElement;

    bindImageDragAndDrop(app);
    bindImageDragAndDrop(app);

    expect(addEventListener).toHaveBeenCalledTimes(4);
    expect(addEventListener.mock.calls.map(([eventName]) => eventName)).toEqual([
      'dragenter',
      'dragover',
      'dragleave',
      'drop',
    ]);
  });
});
