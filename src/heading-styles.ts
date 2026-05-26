import type { JsonObject } from './hvy/types';
import {
  formatStyleCssLines,
  getStyleSpacing,
  sanitizeStyleCss,
  updateStyleSpacingCss,
} from './text-line-styles';

export type HeadingStyleName = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface HeadingStyle {
  label: string;
  css: string;
  afterContentMarginTop: string;
}

export type HeadingStyles = Record<HeadingStyleName, HeadingStyle>;

export const HEADING_STYLE_NAMES: readonly HeadingStyleName[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

const DEFAULT_HEADING_STYLES: HeadingStyles = {
  h1: {
    label: 'Heading 1',
    css: 'margin: 0.35rem 0 0.2rem; font-size: 2rem; font-weight: 700; line-height: 1.15;',
    afterContentMarginTop: '0.7rem',
  },
  h2: {
    label: 'Heading 2',
    css: 'margin: 0.35rem 0 0.2rem; font-weight: 700; line-height: 1.15;',
    afterContentMarginTop: '0.7rem',
  },
  h3: {
    label: 'Heading 3',
    css: 'margin: 0.85rem 0 0.2rem; font-weight: 700; line-height: 1.15;',
    afterContentMarginTop: '1.1rem',
  },
  h4: {
    label: 'Heading 4',
    css: 'margin: 0.35rem 0 0.2rem; font-weight: 700; line-height: 1.15;',
    afterContentMarginTop: '0.7rem',
  },
  h5: {
    label: 'Heading 5',
    css: 'margin: 0.35rem 0 0.2rem; font-weight: 700; line-height: 1.15;',
    afterContentMarginTop: '0.7rem',
  },
  h6: {
    label: 'Heading 6',
    css: 'margin: 0.35rem 0 0.2rem; font-weight: 700; line-height: 1.15;',
    afterContentMarginTop: '0.7rem',
  },
};

export function getHeadingStylesFromMeta(meta: Record<string, unknown> | null | undefined): HeadingStyles {
  const raw = meta?.heading_styles;
  const styles = cloneDefaultHeadingStyles();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return styles;
  }
  for (const name of HEADING_STYLE_NAMES) {
    const candidate = (raw as JsonObject)[name];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }
    const source = candidate as JsonObject;
    styles[name] = {
      label: typeof source.label === 'string' ? source.label : styles[name].label,
      css: typeof source.css === 'string' ? sanitizeHeadingStyleCss(source.css) : styles[name].css,
      afterContentMarginTop: typeof source.afterContentMarginTop === 'string'
        ? sanitizeHeadingMarginTop(source.afterContentMarginTop)
        : styles[name].afterContentMarginTop,
    };
  }
  return styles;
}

export function writeHeadingStylesToMeta(meta: Record<string, unknown>, styles: HeadingStyles): void {
  const clean: JsonObject = {};
  for (const name of HEADING_STYLE_NAMES) {
    const style = styles[name];
    clean[name] = {
      label: style.label,
      css: sanitizeHeadingStyleCss(style.css),
      afterContentMarginTop: sanitizeHeadingMarginTop(style.afterContentMarginTop),
    };
  }
  meta.heading_styles = clean;
}

export function sanitizeHeadingMarginTop(value: string): string {
  const declaration = updateStyleSpacingCss('', 'margin-top', value);
  const match = declaration.match(/(?:^|;\s*)margin-top:\s*([^;]+);?/i);
  return match?.[1]?.trim() ?? '';
}

export function sanitizeHeadingStyleCss(css: string): string {
  return sanitizeStyleCss(css);
}

export function getHeadingStyleSpacing(css: string): Record<string, string> {
  return getStyleSpacing(css);
}

export function updateHeadingStyleSpacingCss(css: string, property: string, value: string): string {
  return updateStyleSpacingCss(css, property, value);
}

export function formatHeadingStyleCssLines(css: string): string {
  return formatStyleCssLines(css);
}

export function getHeadingStyleLabel(name: HeadingStyleName, style: HeadingStyle): string {
  const label = style.label.trim();
  return label.length > 0 ? label : name.toUpperCase();
}

export function renderHeadingStyleElement(meta: Record<string, unknown>, className: string): string {
  const styles = getHeadingStylesFromMeta(meta);
  const selectorPrefix = `.${className}`;
  const selectors = HEADING_STYLE_NAMES.map((name) => {
    const selector = `${selectorPrefix} :is(.reader-block, .rich-editor) ${name}, ${selectorPrefix} .editor-block-passive .reader-block ${name}`;
    return `${selector} { ${styles[name].css} }`;
  });
  const afterSelectors = HEADING_STYLE_NAMES.map((name) => {
    const value = styles[name].afterContentMarginTop.trim();
    if (!value) {
      return '';
    }
    return `${selectorPrefix} :is(.reader-block, .rich-editor) :is(p, ul, ol, blockquote, pre) + ${name}, ${selectorPrefix} .editor-block-passive .reader-block :is(p, ul, ol, blockquote, pre) + ${name} { margin-top: ${value}; }`;
  }).filter(Boolean);
  const resetSelectors = [
    `${selectorPrefix} :is(.reader-block, .rich-editor) > :is(h1, h2, h3, h4, h5, h6):first-child`,
    `${selectorPrefix} :is(.reader-block, .rich-editor) > .hvy-text-line-style:first-child > :is(h1, h2, h3, h4, h5, h6):first-of-type`,
    `${selectorPrefix} .editor-block-passive .reader-block > :is(h1, h2, h3, h4, h5, h6):first-child`,
    `${selectorPrefix} .editor-block-passive .reader-block > .hvy-text-line-style:first-child > :is(h1, h2, h3, h4, h5, h6):first-of-type`,
  ].join(', ');
  const css = [...selectors, ...afterSelectors, `${resetSelectors} { margin-top: 0; }`]
    .join('\n')
    .replace(/<\/style/gi, '<\\/style');
  return `<style data-hvy-heading-styles="true">${css}</style>`;
}

export function getHeadingStyleSurfaceClass(meta: Record<string, unknown>): string {
  const styles = getHeadingStylesFromMeta(meta);
  const value = JSON.stringify(styles);
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return `hvy-heading-style-${hash.toString(36)}`;
}

function cloneDefaultHeadingStyles(): HeadingStyles {
  return JSON.parse(JSON.stringify(DEFAULT_HEADING_STYLES)) as HeadingStyles;
}
