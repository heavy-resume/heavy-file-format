import { expect, test } from 'vitest';

import {
  getHeadingStyleSurfaceClass,
  getHeadingStylesFromMeta,
  renderHeadingStyleElement,
  syncHeadingStyleAfterContentMarginTop,
  updateHeadingStyleSpacingCss,
  writeHeadingStylesToMeta,
} from '../src/heading-styles';
import { deserializeDocument, serializeDocument } from '../src/serialization';

test('heading styles expose adjusted defaults and edge-heading reset CSS', () => {
  const meta = {};
  const styles = getHeadingStylesFromMeta(meta);

  expect(Object.keys(styles)).toEqual(['h1', 'h2', 'h3', 'h4']);
  expect(styles.h1.css).toContain('margin: 2rem 0 0.2rem;');
  expect(styles.h1.afterContentMarginTop).toBe('2rem');
  expect(styles.h2.css).toContain('margin: 1.5rem 0 0.2rem;');
  expect(styles.h2.afterContentMarginTop).toBe('1.5rem');
  expect(styles.h3.css).toContain('margin: 1rem 0 0.2rem;');
  expect(styles.h3.afterContentMarginTop).toBe('1rem');
  expect(styles.h4.css).toContain('margin: 0.5rem 0 0.2rem;');
  expect(styles.h4.afterContentMarginTop).toBe('0.5rem');

  const className = getHeadingStyleSurfaceClass(meta);
  const styleElement = renderHeadingStyleElement(meta, className);

  expect(styleElement).toContain(`.${className} :is(.reader-block, .rich-editor) h3`);
  expect(styleElement).toContain(`+ h3 { margin-top: 1rem; }`);
  expect(styleElement).not.toContain('Heading 5');
  expect(styleElement).not.toContain(' h5 {');
  expect(styleElement).not.toContain(' h6 {');
  expect(styleElement).toContain('margin-top: 0;');
  expect(styleElement).toContain('> :is(h1, h2, h3, h4, h5, h6):last-child');
  expect(styleElement).toContain('> .hvy-text-line-style:last-child > :is(h1, h2, h3, h4, h5, h6):last-of-type');
  expect(styleElement).toContain('margin-bottom: 0;');
});

test('heading style spacing updates preserve other declarations', () => {
  const css = updateHeadingStyleSpacingCss('margin: 0.35rem 0 0.2rem; font-weight: 700;', 'margin-top', '1rem');

  expect(css).toContain('margin-top: 1rem;');
  expect(css).toContain('margin-bottom: 0.2rem;');
  expect(css).toContain('font-weight: 700;');
});

test('syncs after-content margin when heading top margin changes', () => {
  const styles = getHeadingStylesFromMeta({});
  const previousCss = styles.h2.css;
  const css = updateHeadingStyleSpacingCss(styles.h2.css, 'margin-top', '1rem');

  const result = syncHeadingStyleAfterContentMarginTop({ ...styles.h2, css }, previousCss);

  expect(result.afterContentMarginTop).toBe('1rem');
});

test('leaves after-content margin when heading top margin is unchanged', () => {
  const styles = getHeadingStylesFromMeta({});

  const result = syncHeadingStyleAfterContentMarginTop(
    { ...styles.h2, css: `${styles.h2.css} color: red;` },
    styles.h2.css
  );

  expect(result.afterContentMarginTop).toBe(styles.h2.afterContentMarginTop);
});

test('preserves heading_styles in document front matter on round-trip', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
heading_styles:
  h3:
    label: Heading 3
    css: "margin: 0.9rem 0 0.25rem; font-weight: 800;"
    afterContentMarginTop: "1.2rem"
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 ### Foo
`, '.hvy');

  const output = serializeDocument(document);

  expect(output).toContain('heading_styles:');
  expect(output).toContain('h3:');
  expect(output).toContain('css: "margin: 0.9rem 0 0.25rem; font-weight: 800;"');
  expect(output).toContain('afterContentMarginTop: 1.2rem');
});

test('writes edited heading styles to metadata', () => {
  const meta = {};
  const styles = getHeadingStylesFromMeta(meta);
  styles.h2.css = updateHeadingStyleSpacingCss(styles.h2.css, 'margin-top', '0.8rem');

  writeHeadingStylesToMeta(meta, styles);

  expect(meta).toMatchObject({
    heading_styles: {
      h2: {
        css: expect.stringContaining('margin-top: 0.8rem;'),
      },
    },
  });
  expect((meta.heading_styles as Record<string, unknown>).h5).toBeUndefined();
  expect((meta.heading_styles as Record<string, unknown>).h6).toBeUndefined();
});
