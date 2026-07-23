import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('embed button styling is opt-in instead of applied to every button', () => {
  const source = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

  expect(source).not.toContain('.hvy-embed-layout :where(button)');
  expect(source).toContain('.hvy-embed-layout :where(.hvy-button, .secondary, .ghost, .danger, .tiny)');
});

test('floating launchers share one explicit reset class', () => {
  const styleSource = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const chatSource = readFileSync(new URL('../src/chat/chat.ts', import.meta.url), 'utf8');
  const searchSource = readFileSync(new URL('../src/search/render.ts', import.meta.url), 'utf8');
  const searchCssSource = readFileSync(new URL('../src/search/search.css', import.meta.url), 'utf8');
  const hoverRule = styleSource.match(/\.hvy-floating-launcher:not\(:disabled\):hover\s*\{[^}]*\}/)?.[0] ?? '';

  expect(styleSource).toContain('.hvy-floating-launcher');
  expect(chatSource).toContain('class="hvy-floating-launcher chat-launcher"');
  expect(searchSource).toContain('class="hvy-floating-launcher search-launcher');
  expect(searchCssSource).not.toContain('.hvy-embed-layout .search-launcher');
  expect(searchCssSource.match(/\.search-launcher\s*\{[^}]*\}/)?.[0] ?? '').not.toContain('!important');
  expect(hoverRule).toContain('var(--hvy-button-bg) 74%');
  expect(hoverRule).not.toContain('var(--hvy-button-hover-bg');
});

test('embed link hover styling only applies to anchors with href values', () => {
  const source = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

  expect(source).toContain('.hvy-embed-layout a[href]');
  expect(source).toContain('.hvy-embed-layout a[href]:hover');
  expect(source).not.toContain('.hvy-embed-layout a:hover');
});
