import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('reader highlight styling', () => {
  test('adds persistent themed emphasis without overriding component corner styling', () => {
    const source = readFileSync(new URL('../src/reader/reader.css', import.meta.url), 'utf8');
    const expectedResult = source.match(
      /\.hvy-document \.reader-section\.is-highlighted,\s*\.hvy-document \.reader-block\.is-highlighted\s*\{([^}]*)\}/,
    )?.[1] ?? '';

    expect(expectedResult).toContain('background: var(--hvy-highlight-1)');
    expect(expectedResult).toContain('box-shadow: inset 0 0 0 2px var(--hvy-highlight-2)');
    expect(expectedResult).not.toContain('border-radius');
  });

  test('keeps persistent emphasis throughout the temporary themed glow', () => {
    const source = readFileSync(new URL('../src/reader/reader.css', import.meta.url), 'utf8');
    const expectedResult = source.match(/@keyframes reader-view-highlight-glow\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(expectedResult.match(/inset 0 0 0 2px var\(--hvy-highlight-2\)/g)).toHaveLength(3);
    expect(expectedResult).not.toMatch(/rgba\(255,\s*(?:198|218),/);
  });

  test('layers the active search color over the soft match color', () => {
    const source = readFileSync(new URL('../src/search/search.css', import.meta.url), 'utf8');
    const ordinaryMatch = source.match(/\.hvy-document \.search-match-marker\s*\{([^}]*)\}/)?.[1] ?? '';
    const currentMatch = source.match(/\.hvy-document \.search-match-marker\.is-current-search-match\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(ordinaryMatch).toContain('background: var(--hvy-highlight-1)');
    expect(currentMatch).toContain('linear-gradient(var(--hvy-highlight-2), var(--hvy-highlight-2))');
    expect(currentMatch).toContain('var(--hvy-highlight-1)');
    expect(ordinaryMatch).not.toContain('box-shadow');
    expect(currentMatch).not.toContain('box-shadow');
  });
});
