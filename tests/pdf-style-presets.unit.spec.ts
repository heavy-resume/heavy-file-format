import { describe, expect, test } from 'vitest';
import { applyPdfStylePresetToMeta, normalizePdfStylePresets } from '../src/pdf-style-presets';
import type { JsonObject } from '../src/hvy/types';

describe('PDF style presets', () => {
  test('normalizes host-provided presets and ignores duplicate ids', () => {
    const expectedResult = normalizePdfStylePresets([
      {
        id: 'host-polished',
        label: 'Host Polished',
        documentMeta: { pdf_page: { margins: ['0.4in', '0.6in', '0.4in', '0.6in'] } },
      },
      {
        id: 'host-polished',
        label: 'Duplicate',
        documentMeta: { pdf_page: { margins: ['1in', '1in', '1in', '1in'] } },
      },
      {
        id: '',
        label: 'Missing ID',
        documentMeta: { theme: { colors: { '--hvy-bg': '#ffffff' } } },
      },
    ]);

    expect(expectedResult.map((preset) => preset.id)).toEqual(['host-polished']);
  });

  test('keeps an explicit empty host preset list empty', () => {
    expect(normalizePdfStylePresets([])).toEqual([]);
    expect(normalizePdfStylePresets(null).length).toBeGreaterThan(0);
  });

  test('applies preset metadata as editable document metadata', () => {
    const meta: JsonObject = {
      title: 'Example',
      theme: {
        colors: {
          '--hvy-bg': '#ffffff',
          '--hvy-text': '#111827',
        },
      },
      pdf_page: {
        debug: true,
      },
    };

    applyPdfStylePresetToMeta(meta, {
      id: 'expected-result',
      label: 'Expected Result',
      documentMeta: {
        theme: {
          colors: {
            '--hvy-bg': '#f8fafc',
            '--hvy-accent-1': '#24566f',
          },
        },
        pdf_page: {
          margins: ['0.5in', '0.5in', '0.5in', '0.5in'],
        },
      },
    });

    expect(meta).toEqual({
      title: 'Example',
      theme: {
        colors: {
          '--hvy-bg': '#f8fafc',
          '--hvy-text': '#111827',
          '--hvy-accent-1': '#24566f',
        },
      },
      pdf_page: {
        debug: true,
        margins: ['0.5in', '0.5in', '0.5in', '0.5in'],
      },
    });
  });
});
