import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { expect, test } from 'vitest';

const sourceRoot = new URL('../src', import.meta.url).pathname;
const stylesheetBoundaries = new Map([
  ['layout/reference-application-controls.css', '.hvy-reference-app'],
  ['layout/reference-shell.css', '.hvy-reference-host'],
  ['state-tracker.css', '.hvy-reference-app'],
]);

function listCssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listCssFiles(path) : extname(entry.name) === '.css' ? [path] : [];
  });
}

function isInsideKeyframes(rule: Rule): boolean {
  let parent = rule.parent;
  while (parent) {
    if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return true;
    parent = parent.parent;
  }
  return false;
}

test('expected result: authored CSS owns an explicit application boundary', () => {
  const failures: Array<{ file: string; selector: string; expectedBoundary: string }> = [];

  for (const file of listCssFiles(sourceRoot)) {
    const relativePath = relative(sourceRoot, file);
    if (relativePath.startsWith('palettes/')) continue;
    const expectedBoundary = stylesheetBoundaries.get(relativePath) ?? '.hvy-document';
    postcss.parse(readFileSync(file, 'utf8'), { from: file }).walkRules((rule) => {
      if (isInsideKeyframes(rule)) return;
      for (const selector of rule.selectors) {
        if (selector !== expectedBoundary && !selector.startsWith(`${expectedBoundary} `)
          && !selector.startsWith(`${expectedBoundary}.`) && !selector.startsWith(`${expectedBoundary}:`)
          && !selector.startsWith(`${expectedBoundary}[`)) {
          failures.push({ file: relativePath, selector, expectedBoundary });
        }
      }
    });
  }

  expect(failures).toEqual([]);
});

test('expected result: embed build does not rewrite CSS selectors', () => {
  const source = readFileSync(new URL('../vite.embed.config.ts', import.meta.url), 'utf8');

  expect(source).not.toContain('hvy-embed-css-scope');
  expect(source).not.toContain('generateBundle');
  expect(source).not.toContain('postcss');
});

test('expected result: reference-only CSS is absent from shared style imports', () => {
  const sharedStyles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const referenceEntry = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

  expect(sharedStyles).not.toContain('reference-application-controls.css');
  expect(referenceEntry).toContain("import './layout/reference-shell.css';");
  expect(referenceEntry).toContain("import './layout/reference-application-controls.css';");
  expect(referenceEntry).toContain("app.classList.add('hvy-reference-app', 'hvy-document');");
});

test('expected result: shared editor block shells do not style plugin-owned form elements', () => {
  const failures: Array<{ file: string; selector: string; shell: string; element: string }> = [];
  const protectedShells = ['.editor-block', '.editor-block-content', '.hvy-plugin-mount'];

  for (const file of listCssFiles(sourceRoot)) {
    const relativePath = relative(sourceRoot, file);
    postcss.parse(readFileSync(file, 'utf8'), { from: file }).walkRules((rule) => {
      if (isInsideKeyframes(rule)) return;
      for (const selector of rule.selectors) {
        for (const shell of protectedShells) {
          const shellPosition = selector.indexOf(shell);
          if (shellPosition < 0) continue;
          const descendantSelector = selector.slice(shellPosition + shell.length);
          const elementMatch = descendantSelector.match(/(?:^|[\s>+~])(?:input|select|textarea|label)(?=$|[\s.#[:>+~])/);
          if (elementMatch) {
            failures.push({
              file: relativePath,
              selector,
              shell,
              element: elementMatch[0].trim(),
            });
          }
        }
      }
    });
  }

  expect(failures).toEqual([]);
});
