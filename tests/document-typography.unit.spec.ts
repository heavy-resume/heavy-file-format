import { expect, test } from 'vitest';

import {
  DEFAULT_PARAGRAPH_SPACING,
  getDocumentParagraphSpacing,
  getDocumentRecolorStrikethrough,
  writeDocumentRecolorStrikethrough,
  getParagraphGapCss,
  getParagraphSplitMarginTop,
  isDocumentParagraphSpacing,
  writeDocumentParagraphSpacing,
} from '../src/document-typography';

test('expected result: paragraph spacing defaults to the existing reader value', () => {
  expect(getDocumentParagraphSpacing({})).toBe(DEFAULT_PARAGRAPH_SPACING);
});

test('expected result: paragraph spacing accepts a document-configured CSS length', () => {
  const meta = {};

  writeDocumentParagraphSpacing(meta, '0.7rem');

  expect(meta).toEqual({ typography: { paragraphSpacing: '0.7rem' } });
  expect(getDocumentParagraphSpacing(meta)).toBe('0.7rem');
});

test('expected result: invalid or negative document spacing falls back to the current default', () => {
  expect(isDocumentParagraphSpacing('-1rem')).toBe(false);
  expect(getDocumentParagraphSpacing({ typography: { paragraphSpacing: 'wide' } })).toBe(DEFAULT_PARAGRAPH_SPACING);

  const meta = {};
  writeDocumentParagraphSpacing(meta, '-1rem');
  expect(meta).toEqual({ typography: { paragraphSpacing: DEFAULT_PARAGRAPH_SPACING } });
});

test('expected result: paragraph spacing can be multiplied for generated component CSS', () => {
  expect(getParagraphGapCss('0.6rem', 2)).toBe('1.2rem');
  expect(getParagraphSplitMarginTop(
    'margin: 0.5rem 0;',
    { typography: { paragraphSpacing: '0.6rem' } },
    2
  )).toBe('0.7rem');
});


test('expected result: strikethrough recoloring is opt-in and preserves other typography settings', () => {
  expect(getDocumentRecolorStrikethrough({})).toBe(false);
  expect(getDocumentRecolorStrikethrough({ typography: { recolorStrikethrough: 'true' } })).toBe(false);
  const meta = { typography: { paragraphSpacing: '0.7rem' } };
  writeDocumentRecolorStrikethrough(meta, true);
  expect(getDocumentRecolorStrikethrough(meta)).toBe(true);
  expect(meta.typography).toEqual({ paragraphSpacing: '0.7rem', recolorStrikethrough: true });
  writeDocumentRecolorStrikethrough(meta, false);
  expect(getDocumentRecolorStrikethrough(meta)).toBe(false);
  expect(getDocumentParagraphSpacing(meta)).toBe('0.7rem');
});
