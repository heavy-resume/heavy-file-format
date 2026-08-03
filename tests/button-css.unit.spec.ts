import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('embed button styling is opt-in instead of applied to every button', () => {
  const source = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

  expect(source).not.toContain('.hvy-embed-layout :where(button)');
  expect(source).toContain('.hvy-document .hvy-button');
  expect(source).toContain('.hvy-document .secondary');
  expect(source).not.toMatch(/(^|,)\s*button\s*[{,:]/m);
});

test('entry styles use explicit component classes instead of structural selector helpers', () => {
  const styleSources = [
    readFileSync(new URL('../src/default-theme.css', import.meta.url), 'utf8'),
    readFileSync(new URL('../src/host-overrides.css', import.meta.url), 'utf8'),
    readFileSync(new URL('../src/style.css', import.meta.url), 'utf8'),
  ];
  const layoutSource = styleSources[2];

  for (const source of styleSources) {
    expect(source).not.toContain(':where(');
    expect(source).not.toContain(':has(');
  }
  expect(styleSources[0]).not.toContain(':root');
  expect(styleSources[0]).toContain('.hvy-document.theme-dark');
  expect(styleSources[1]).toMatch(/^\.hvy-document\s*\{/);
  expect(layoutSource).toMatch(/^\.hvy-document\s*\{/);
  expect(layoutSource).toContain('.document-menu-toggle');
  expect(layoutSource).toContain('.toolbar-filename-input');
  expect(layoutSource).toContain('.compact-control-button');
  expect(layoutSource).toContain('.meta-filter-options-toggle');
  expect(layoutSource).toContain('.workspace-content-pane');
  expect(layoutSource).toContain('.viewer-document-scroll');
  expect(layoutSource).not.toMatch(/\.(?:document-menu|meta-filter-options)\s+summary/);
  expect(layoutSource).not.toMatch(/\.pane\s+h[1-6]/);
  expect(layoutSource).not.toContain('.viewer-shell .reader-document');
});

test('component controls own their dimensions independently of stylesheet order', () => {
  const layoutSource = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const databaseTableSource = readFileSync(new URL('../src/plugins/db-table/db-table-component.css', import.meta.url), 'utf8');
  const databaseTableMarkup = readFileSync(new URL('../src/plugins/db-table/db-table-component.ts', import.meta.url), 'utf8');

  expect(layoutSource).toContain('@layer hvy-control-defaults');
  expect(databaseTableSource.match(/\.db-v2-sort\s*\{[^}]*\}/)?.[0] ?? '').toContain('padding: 0.3rem');
  expect(databaseTableSource).toContain('.db-v2-page-button');
  expect(databaseTableSource).not.toContain('.db-v2-pager button');
  expect(databaseTableMarkup).toContain('class="ghost db-v2-sort"');
  expect(databaseTableMarkup).toContain('class="ghost db-v2-page-button"');
});

test('application entrypoints load theme, host overrides, then component styles', () => {
  const expectedImports = [
    "import './default-theme.css';",
    "import './host-overrides.css';",
    "import './style.css';",
  ];

  for (const entrypoint of ['main.ts', 'embed.ts', 'embed-full.ts']) {
    const source = readFileSync(new URL(`../src/${entrypoint}`, import.meta.url), 'utf8');
    const importPositions = expectedImports.map((statement) => source.indexOf(statement));
    expect(importPositions.every((position) => position >= 0)).toBe(true);
    expect(importPositions).toEqual([...importPositions].sort((left, right) => left - right));
  }
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
