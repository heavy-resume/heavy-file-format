import { describe, expect, test, vi } from 'vitest';

import { HvyPdfArtifactCache } from '../src/pdf-preview/pdf-artifact-cache';
import type { VisualDocument } from '../src/types';

function createDocument(text = 'First version'): VisualDocument {
  return {
    meta: { hvy_version: 0.1 },
    extension: '.phvy',
    attachments: [],
    sections: [{
      key: 'section-preview',
      customId: 'preview',
      title: 'Preview',
      location: 'main',
      blocks: [{
        id: 'block-preview',
        text,
        schema: {
          kind: 'text',
          id: 'preview-text',
          component: 'text',
          editorOnly: false,
          lock: false,
          align: 'left',
          slot: 'center',
          css: '',
          sortKeys: {},
          derivedSortKeyNames: [],
          groupKeys: {},
          tags: '',
          description: '',
          hideIfYes: '',
          visibleScript: '',
          placeholder: '',
          fillIn: false,
          showCopy: false,
          metaOpen: false,
          xrefTitle: '',
          xrefDetail: '',
        },
      }],
      children: [],
      contained: false,
      expanded: true,
      lock: false,
      editorOnly: false,
      css: '',
      tags: '',
      description: '',
      reusable: false,
      reusableId: '',
      reusableVersion: '',
      reusableSource: '',
      reusableSync: false,
      reusableOverrides: {},
    }],
  };
}

describe('PDF artifact cache', () => {
  test('expected result: unchanged documents share one in-flight and completed artifact', async () => {
    const cache = new HvyPdfArtifactCache();
    const document = createDocument();
    const generate = vi.fn(async () => new Blob(['pdf'], { type: 'application/pdf' }));

    const first = cache.get(document, generate);
    const second = cache.get(document, generate);

    expect(second).toBe(first);
    await expect(first).resolves.toBeInstanceOf(Blob);
    expect(generate).toHaveBeenCalledTimes(1);
    await expect(cache.get(document, generate)).resolves.toBe(await first);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  test('expected result: a new object with unchanged serialized content reuses the artifact', async () => {
    const cache = new HvyPdfArtifactCache();
    const generate = vi.fn(async () => new Blob(['pdf'], { type: 'application/pdf' }));
    const before = await cache.get(createDocument(), generate);
    const after = await cache.get(createDocument(), generate);

    expect(after).toBe(before);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  test('expected result: a serialized document change generates a new artifact', async () => {
    const cache = new HvyPdfArtifactCache();
    const document = createDocument();
    const generate = vi.fn(async () => new Blob([String(generate.mock.calls.length)], { type: 'application/pdf' }));
    const before = await cache.get(document, generate);

    document.sections[0]!.blocks[0]!.text = 'Second version';
    const after = await cache.get(document, generate);

    expect(after).not.toBe(before);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  test('expected result: a failed artifact is retryable', async () => {
    const cache = new HvyPdfArtifactCache();
    const document = createDocument();
    const generate = vi.fn()
      .mockRejectedValueOnce(new Error('first render failed'))
      .mockResolvedValueOnce(new Blob(['pdf'], { type: 'application/pdf' }));

    await expect(cache.get(document, generate)).rejects.toThrow('first render failed');
    await expect(cache.get(document, generate)).resolves.toBeInstanceOf(Blob);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
