import { beforeEach, expect, test } from 'vitest';

import { renderTextEditor } from '../src/editor/components/text/text';
import { renderTextReader } from '../src/editor/components/text/text';
import { renderXrefCardEditor } from '../src/editor/components/xref-card/xref-card';
import { initState, state } from '../src/state';
import type { VisualBlock } from '../src/editor/types';
import { createTestState } from './serialization-test-helpers';

const helpers = {
  escapeAttr: (value: string) => value,
  escapeHtml: (value: string) => value,
  isMobileAdjustmentMode: () => false,
  markdownToEditorHtml: (value: string) => `<p>${value}</p>`,
  renderRichToolbar: () => '',
  isXrefTargetValid: () => true,
  getXrefTargetOptions: () => [],
  renderTextFragment: (content: string) => `<p>${content}</p>`,
  renderComponentFragment: (_componentName: string, content: string) => `<p>${content}</p>`,
};

beforeEach(() => {
  initState(createTestState({
    meta: {},
    extension: '.hvy',
    attachments: [],
    sections: [],
  }));
});

test('text editor prose surfaces opt into native spellcheck', () => {
  const block = {
    id: 'body-copy',
    text: 'A misspeled word',
    schema: {
      align: '',
      component: 'text',
      fillIn: false,
      placeholder: '',
    },
  } as unknown as VisualBlock;

  expect(renderTextEditor('summary', block, helpers as never)).toContain('spellcheck="true"');
});

test('text fill-in editor opt into native spellcheck', () => {
  const block = {
    id: 'fill-copy',
    text: 'Hello <!-- value -->',
    schema: {
      align: '',
      component: 'text',
      fillIn: true,
      placeholder: 'name',
    },
  } as unknown as VisualBlock;

  state.activeTextEditorMode = { sectionKey: 'summary', blockId: 'fill-copy', mode: 'fill-in' };
  const html = renderTextEditor('summary', block, helpers as never);

  expect(html).toContain('class="text-fill-in-box"');
  expect(html).toContain('contenteditable="true"');
  expect(html).toContain('spellcheck="true"');
});

test('xref title and detail editors opt into native spellcheck', () => {
  const block = {
    id: 'skill-card',
    text: '',
    schema: {
      component: 'xref-card',
      xrefTitle: 'TypScript',
      xrefDetail: 'Primarry language',
      xrefTarget: 'tool-typescript',
      xrefTargetTagFilter: '',
    },
  } as unknown as VisualBlock;

  const html = renderXrefCardEditor('summary', block, helpers as never);

  expect(html.match(/spellcheck="true"/g)).toHaveLength(2);
  expect(html).toContain('data-field="block-xref-title"');
  expect(html).toContain('data-field="block-xref-detail"');
  expect(html).toContain('data-placeholder="Optional"');
});

test('text reader can show a copy button for any text component', () => {
  const block = {
    id: 'body-copy',
    text: 'Copy me',
    schema: {
      align: '',
      component: 'text',
      fillIn: false,
      placeholder: '',
      showCopy: true,
    },
  } as unknown as VisualBlock;
  const section = { key: 'summary' };

  const html = renderTextReader(section as never, block, helpers as never);

  expect(html).toContain('data-action="copy-text-component"');
  expect(html).toContain('data-section-key="summary"');
  expect(html).toContain('data-block-id="body-copy"');
  expect(html).toContain('<p>Copy me</p>');
});
