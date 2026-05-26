import { expect, test } from 'vitest';

import {
  getHeadingStyleSurfaceClass,
  getHeadingStylesFromMeta,
  renderHeadingStyleElement,
  updateHeadingStyleSpacingCss,
  writeHeadingStylesToMeta,
} from '../src/heading-styles';
import { deserializeDocument, serializeDocument } from '../src/serialization';

test('heading styles expose adjusted defaults and first-heading reset CSS', () => {
  const meta = {};
  const styles = getHeadingStylesFromMeta(meta);

  expect(styles.h3.css).toContain('margin: 0.85rem 0 0.2rem;');
  expect(styles.h3.afterContentMarginTop).toBe('1.1rem');

  const className = getHeadingStyleSurfaceClass(meta);
  const styleElement = renderHeadingStyleElement(meta, className);

  expect(styleElement).toContain(`.${className} :is(.reader-block, .rich-editor) h3`);
  expect(styleElement).toContain(`+ h3 { margin-top: 1.1rem; }`);
  expect(styleElement).toContain('margin-top: 0;');
});

test('heading style spacing updates preserve other declarations', () => {
  const css = updateHeadingStyleSpacingCss('margin: 0.35rem 0 0.2rem; font-weight: 700;', 'margin-top', '1rem');

  expect(css).toContain('margin-top: 1rem;');
  expect(css).toContain('margin-bottom: 0.2rem;');
  expect(css).toContain('font-weight: 700;');
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
});
