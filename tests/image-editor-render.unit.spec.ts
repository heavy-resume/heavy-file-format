import { describe, expect, test, vi } from 'vitest';

import { getCarouselSlideScrollLeft, getNearestCarouselSlide, renderCarouselEditor, renderCarouselReader } from '../src/editor/components/carousel/carousel';
import { bindImageDragAndDrop, renderImageEditor, renderImageReader } from '../src/editor/components/image/image';
import { ensureDocumentAttachmentStore } from '../src/attachment-store';
import { createHostedAttachmentAdapter } from '../src/hosted-attachments';
import type { ComponentRenderHelpers } from '../src/editor/component-helpers';
import { createEmptyBlock, createEmptySection } from '../src/document-factory';
import { initState } from '../src/state';
import { escapeAttr, escapeHtml } from '../src/utils';
import type { VisualBlock } from '../src/editor/types';
import { createTestState } from './serialization-test-helpers';
import { createDefaultTextCaption } from '../src/caption';

const helpers: ComponentRenderHelpers = {
  escapeAttr,
  escapeHtml,
  markdownToEditorHtml: (markdown) => markdown,
  renderRichToolbar: () => '',
  renderComponentFragment: (_componentName, content) => content,
  renderEditorBlock: () => '',
  renderPassiveEditorBlock: () => '',
  renderReaderBlock: () => '',
  renderReaderBlocks: () => '',
  renderReaderListBlocks: () => '',
  orderReaderBlocks: (blocks) => blocks,
  orderReaderListBlocks: (blocks) => blocks,
  isReaderViewPrioritizedBlock: () => false,
  renderTextFragment: (content) => content,
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
    block.schema.caption = createDefaultTextCaption('Team photo');
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
    expect(expectedResult).toContain('Use an attached image');
    expect(expectedResult).toContain('Use image');
    expect(expectedResult).toContain('Current image');
    expect(expectedResult).toContain('aria-label="Use image: unused.jpg"');
    expect(expectedResult).toContain('data-image-filename="avatar.jpg"');
    expect(expectedResult).toContain('data-action="image-delete-current"');
    expect(expectedResult).toContain('data-action="image-delete-unused"');
    expect(expectedResult).toContain('data-image-filename="unused.jpg"');
    expect(expectedResult).toContain('data-action="open-image-caption-modal"');
    expect(expectedResult).toContain('<figcaption class="image-caption" style="text-align: center;">Team photo</figcaption>');
    expect(expectedResult).not.toContain('aria-label="Delete unused image avatar.jpg"');
    expect(expectedResult).toContain('download="avatar.jpg"');
  });

  test('expected result: image size picker indicates the current preset', () => {
    const block: VisualBlock = createEmptyBlock('image');
    block.id = 'photo';
    block.schema.css = 'margin: 0.5rem auto; display: block; width: 40rem; height: auto;';
    initState(createTestState({
      meta: {},
      extension: '.phvy',
      sections: [createEmptySection(1)],
      attachments: [],
    }));

    const expectedResult = renderImageEditor('profile', block, helpers);

    const largeButton = expectedResult.match(/<button(?:(?!<button)[\s\S])*data-image-preset="large"(?:(?!<button)[\s\S])*?>/)?.[0] ?? '';
    const mediumButton = expectedResult.match(/<button(?:(?!<button)[\s\S])*data-image-preset="medium"(?:(?!<button)[\s\S])*?>/)?.[0] ?? '';
    const smallButton = expectedResult.match(/<button(?:(?!<button)[\s\S])*data-image-preset="small"(?:(?!<button)[\s\S])*?>/)?.[0] ?? '';
    expect(largeButton).toContain('is-active');
    expect(largeButton).toContain('aria-pressed="true"');
    expect(mediumButton).toContain('aria-pressed="false"');
    expect(smallButton).not.toContain('is-active');
    expect(smallButton).toContain('aria-pressed="false"');
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
    expect(expectedResult).toContain('Add attached images to carousel');
    expect(expectedResult).toContain('Add to carousel');
    expect(expectedResult).toContain('aria-label="Add to carousel: slide.jpg"');
    expect(expectedResult).toContain('data-field="carousel-show-frame"');
    expect(expectedResult).toContain('data-image-filename="slide.jpg"');
    expect(expectedResult).toContain('data-action="carousel-download"');
    expect(expectedResult).toContain('data-action="carousel-remove"');
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

  test('expected result: hosted image component defers static url until lazy hydration', () => {
    const block: VisualBlock = createEmptyBlock('image');
    block.schema.imageFile = 'static-photo.png';
    block.schema.imageAlt = 'Static Photo';
    const document = createTestState({
      meta: {},
      extension: '.hvy',
      sections: [createEmptySection(1)],
      attachments: [],
    });
    const attachmentStore = createHostedAttachmentAdapter({
      attachments: [
        {
          id: 'image:static-photo.png',
          meta: { mediaType: 'image/png' },
          length: 45 * 1024 * 1024,
          url: 'image/static-photo.png',
        },
      ],
    });
    initState({ ...document, attachmentHost: attachmentStore });
    ensureDocumentAttachmentStore(document.document).setDescriptor({
      id: 'image:static-photo.png',
      meta: { mediaType: 'image/png' },
      length: 45 * 1024 * 1024,
    });

    const expectedResult = renderImageReader(createEmptySection(1), block, helpers);

    expect(expectedResult).toContain('data-hvy-lazy-image="true"');
    expect(expectedResult).toContain('data-image-filename="static-photo.png"');
    expect(expectedResult).toContain('loading="lazy"');
    expect(expectedResult).not.toContain('src="./image/static-photo.png"');
    expect(ensureDocumentAttachmentStore(document.document).isMaterialized('image:static-photo.png')).toBe(false);
  });

  test('expected result: carousel reader defers slide src assignment until runtime hydration', () => {
    const block: VisualBlock = createEmptyBlock('carousel');
    block.schema.carouselImages = [
      { imageFile: 'slide-a.png', imageAlt: 'Slide A', caption: '' },
      { imageFile: 'slide-b.png', imageAlt: 'Slide B', caption: '' },
    ];
    const document = createTestState({
      meta: {},
      extension: '.hvy',
      sections: [createEmptySection(1)],
      attachments: [
        { id: 'image:slide-a.png', meta: { mediaType: 'image/png' }, bytes: new Uint8Array([1]) },
        { id: 'image:slide-b.png', meta: { mediaType: 'image/png' }, bytes: new Uint8Array([2]) },
      ],
    });
    initState(document);

    const expectedResult = renderCarouselReader(createEmptySection(1), block, helpers);

    expect(expectedResult).toContain('data-hvy-carousel-lazy-image="true"');
    expect(expectedResult).toContain('data-image-filename="slide-a.png"');
    expect(expectedResult).toContain('data-image-filename="slide-b.png"');
    expect(expectedResult).not.toContain('src="blob:');
  });

  test('expected result: carousel reader renders edge clones for circular touch scrolling', () => {
    const block: VisualBlock = createEmptyBlock('carousel');
    block.schema.carouselImages = [
      { imageFile: 'slide-a.png', imageAlt: 'Slide A', caption: '' },
      { imageFile: 'slide-b.png', imageAlt: 'Slide B', caption: '' },
    ];

    const expectedResult = renderCarouselReader(createEmptySection(1), block, helpers);

    expect(expectedResult).toContain('data-carousel-clone="last" aria-hidden="true"');
    expect(expectedResult).toContain('data-carousel-clone="first" aria-hidden="true"');
    expect(expectedResult.match(/data-carousel-slide="/g)).toHaveLength(2);
    expect(expectedResult.match(/data-carousel-real-index="/g)).toHaveLength(4);
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

  test('expected result: carousel scroll state follows the nearest visible slide', () => {
    const slides = [0, 400, 800].map((scrollLeft, index) => ({
      dataset: { carouselRealIndex: String(index) },
      getBoundingClientRect: () => ({ left: scrollLeft - 790 }),
    })) as unknown as HTMLElement[];
    const track = {
      scrollLeft: 790,
      querySelectorAll: () => slides,
      getBoundingClientRect: () => ({ left: 0 }),
    } as unknown as HTMLElement;

    const expectedResult = getNearestCarouselSlide(track);

    expect(expectedResult?.dataset.carouselRealIndex).toBe('2');
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
