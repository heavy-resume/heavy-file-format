import { expect, test } from 'vitest';

import { renderNewDocumentModal } from '../src/new-document-modal';
import { escapeHtml } from '../src/utils';

test('renderNewDocumentModal renders three document type choices', () => {
  const html = renderNewDocumentModal(true, { escapeAttr: escapeHtml, escapeHtml });

  expect(html).toContain('data-new-document-extension=".hvy"');
  expect(html).toContain('data-new-document-extension=".thvy"');
  expect(html).toContain('data-new-document-extension=".phvy"');
});

test('renderNewDocumentModal omits markup when closed', () => {
  expect(renderNewDocumentModal(false, { escapeAttr: escapeHtml, escapeHtml })).toBe('');
});
