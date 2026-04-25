import { describe, expect, test } from 'vitest';
import {
  cssFragmentTriggersNetwork,
  decodeCssEscapes,
  sanitizeCssBlock,
  sanitizeInlineCss,
} from '../src/css-sanitizer';

describe('decodeCssEscapes', () => {
  test('decodes hex escapes with optional whitespace terminator', () => {
    expect(decodeCssEscapes('u\\72l')).toBe('url');
    expect(decodeCssEscapes('u\\000072l')).toBe('url');
    expect(decodeCssEscapes('u\\72 l')).toBe('url');
  });

  test('decodes literal backslash escapes', () => {
    expect(decodeCssEscapes('\\URL(')).toBe('URL(');
  });
});

describe('cssFragmentTriggersNetwork', () => {
  test('detects url(), image-set(), and src() functions', () => {
    expect(cssFragmentTriggersNetwork('background: url("https://example.com/x")')).toBe(true);
    expect(cssFragmentTriggersNetwork('background: URL(https://example.com/x)')).toBe(true);
    expect(cssFragmentTriggersNetwork('background: image-set(url("/x") 1x)')).toBe(true);
    expect(cssFragmentTriggersNetwork('src: src("a.woff2")')).toBe(true);
  });

  test('detects obfuscated url via CSS escapes', () => {
    expect(cssFragmentTriggersNetwork('background: u\\72l("https://example.com/x")')).toBe(true);
    expect(cssFragmentTriggersNetwork('background: \\55RL(https://example.com/x)')).toBe(true);
  });

  test('detects fetching at-rules', () => {
    expect(cssFragmentTriggersNetwork('@import "x.css";')).toBe(true);
    expect(cssFragmentTriggersNetwork('@font-face { src: url(x); }')).toBe(true);
    expect(cssFragmentTriggersNetwork('@namespace url(x);')).toBe(true);
    expect(cssFragmentTriggersNetwork('@property --x { syntax: "*"; }')).toBe(true);
  });

  test('leaves harmless declarations alone', () => {
    expect(cssFragmentTriggersNetwork('margin: 0.5rem 0;')).toBe(false);
    expect(cssFragmentTriggersNetwork('color: var(--hvy-text);')).toBe(false);
    expect(cssFragmentTriggersNetwork('text-align: center;')).toBe(false);
  });
});

describe('sanitizeInlineCss', () => {
  test('drops declarations that fetch by default', () => {
    const before = 'margin: 0.5rem 0; background: url("https://example.com/x"); color: red;';
    const result = sanitizeInlineCss(before);
    expect(result).not.toMatch(/url\s*\(/i);
    expect(result).toContain('margin: 0.5rem 0');
    expect(result).toContain('color: red');
  });

  test('drops obfuscated url declarations', () => {
    const result = sanitizeInlineCss('background: u\\72l("https://e.com/x"); color: red;');
    expect(result).not.toMatch(/u\\72l/);
    expect(result).toContain('color: red');
  });

  test('drops image-set and src() function declarations', () => {
    const result = sanitizeInlineCss(
      'background: image-set(url("/x") 1x); padding: 1rem; src: src("a.woff2");'
    );
    expect(result).not.toMatch(/image-set/i);
    expect(result).not.toMatch(/\bsrc\s*\(/i);
    expect(result).toContain('padding: 1rem');
  });

  test('passes content through unchanged when external resources are explicitly allowed', () => {
    const before = 'background: url("https://example.com/x");';
    expect(sanitizeInlineCss(before, { allowExternal: true })).toBe(before);
  });
});

describe('sanitizeCssBlock', () => {
  test('strips @import, @font-face, @namespace, and @property at-rules', () => {
    const before = `
      @import url("x.css");
      @font-face { font-family: F; src: url("a.woff2"); }
      @namespace url(http://www.w3.org/1999/xhtml);
      @property --x { syntax: "*"; inherits: false; initial-value: 0; }
      .ok { color: red; }
    `;
    const result = sanitizeCssBlock(before);
    expect(result).not.toMatch(/@import/i);
    expect(result).not.toMatch(/@font-face/i);
    expect(result).not.toMatch(/@namespace/i);
    expect(result).not.toMatch(/@property/i);
    expect(result).toContain('.ok');
    expect(result).toContain('color: red');
  });

  test('strips url() declarations from inside rule bodies', () => {
    const before = `.x { color: red; background: url("https://example.com/x"); padding: 1rem; }`;
    const result = sanitizeCssBlock(before);
    expect(result).not.toMatch(/url\s*\(/i);
    expect(result).toContain('color: red');
    expect(result).toContain('padding: 1rem');
  });

  test('returns unchanged when external resources are explicitly allowed', () => {
    const before = '@import "x.css"; .x { background: url("/x"); }';
    expect(sanitizeCssBlock(before, { allowExternal: true })).toBe(before);
  });
});
