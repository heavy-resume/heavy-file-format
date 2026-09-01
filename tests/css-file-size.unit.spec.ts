import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { expect, test } from 'vitest';

function listCssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return listCssFiles(path);
    }
    return extname(entry.name) === '.css' ? [path] : [];
  });
}

test('expected result: source stylesheets stay at or below 1,000 lines', () => {
  const oversizedStylesheets = listCssFiles(new URL('../src', import.meta.url).pathname)
    .map((file) => ({
      file,
      lines: readFileSync(file, 'utf8').split(/\r?\n/).length - 1,
    }))
    .filter(({ lines }) => lines > 1000);

  expect(oversizedStylesheets).toEqual([]);
});

test('expected result: stylesheet entrypoints preserve split-file cascade order', () => {
  expect(readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')).toBe([
    "@import './layout/hvy-layout-foundation.css';",
    "@import './layout/hvy-control-primitives.css';",
    "@import './layout/hvy-floating-controls.css';",
    "@import './layout/workspace-layout.css';",
    '',
  ].join('\n'));
  expect(readFileSync(new URL('../src/editor/editor.css', import.meta.url), 'utf8')).toBe([
    "@import './editor-shell.css';",
    "@import './editor-section-cards.css';",
    "@import './editor-component-picker.css';",
    "@import './editor-form-controls.css';",
    "@import './editor-metadata.css';",
    "@import './component-editor-modal.css';",
    '',
  ].join('\n'));
  expect(readFileSync(new URL('../src/editor/components/text/text.css', import.meta.url), 'utf8')).toBe([
    "@import './text-reader-presentation.css';",
    "@import './text-editor-toolbar.css';",
    "@import './text-rich-content.css';",
    '',
  ].join('\n'));
});
