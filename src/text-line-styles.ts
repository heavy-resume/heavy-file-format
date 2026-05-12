import type { JsonObject } from './hvy/types';
import { sanitizeInlineCss } from './css-sanitizer';

export interface TextLineStyle {
  label: string;
  css: string;
}

export type TextLineStyles = Record<string, TextLineStyle>;

export const TEXT_LINE_STYLE_NAME_PATTERN = /^[a-z0-9_-]+$/;

export function getTextLineStylesFromMeta(meta: Record<string, unknown> | null | undefined): TextLineStyles {
  const raw = meta?.text_line_styles;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const styles: TextLineStyles = {};
  for (const [name, value] of Object.entries(raw as JsonObject)) {
    if (!TEXT_LINE_STYLE_NAME_PATTERN.test(name) || !value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    const candidate = value as JsonObject;
    styles[name] = {
      label: typeof candidate.label === 'string' ? candidate.label : '',
      css: typeof candidate.css === 'string' ? candidate.css : '',
    };
  }
  return styles;
}

export function writeTextLineStylesToMeta(meta: Record<string, unknown>, styles: TextLineStyles): void {
  const clean: JsonObject = {};
  for (const [name, style] of Object.entries(styles)) {
    if (!TEXT_LINE_STYLE_NAME_PATTERN.test(name)) {
      continue;
    }
    clean[name] = {
      label: style.label,
      css: style.css,
    };
  }
  if (Object.keys(clean).length === 0) {
    delete meta.text_line_styles;
    return;
  }
  meta.text_line_styles = clean;
}

export function sanitizeTextLineStyleCss(css: string): string {
  return sanitizeInlineCss(css);
}

export function getTextLineStylePreviewCss(css: string): string {
  return serializeCssDeclarations(
    parseCssDeclarations(sanitizeTextLineStyleCss(css)).filter(
      ({ property }) => !/^(margin|padding)(-|$)/.test(property)
    )
  );
}

export function formatTextLineStyleCssLines(css: string): string {
  return parseCssDeclarations(sanitizeTextLineStyleCss(css))
    .map(({ property, value }) => `${property}: ${value};`)
    .join('\n');
}

export function getTextLineStyleSpacing(css: string): Record<string, string> {
  const declarations = parseCssDeclarations(sanitizeTextLineStyleCss(css));
  const spacing: Record<string, string> = {
    'margin-top': '',
    'margin-right': '',
    'margin-bottom': '',
    'margin-left': '',
    'padding-top': '',
    'padding-right': '',
    'padding-bottom': '',
    'padding-left': '',
  };
  for (const { property, value } of declarations) {
    if (property === 'margin' || property === 'padding') {
      const [top, right, bottom, left] = expandBoxValue(value);
      spacing[`${property}-top`] = top;
      spacing[`${property}-right`] = right;
      spacing[`${property}-bottom`] = bottom;
      spacing[`${property}-left`] = left;
    } else if (property in spacing) {
      spacing[property] = value;
    }
  }
  return spacing;
}

export function updateTextLineStyleSpacingCss(css: string, property: string, value: string): string {
  const spacing = getTextLineStyleSpacing(css);
  if (!(property in spacing)) {
    return sanitizeTextLineStyleCss(css);
  }
  spacing[property] = value.trim();
  const preserved = parseCssDeclarations(sanitizeTextLineStyleCss(css)).filter(
    (declaration) => !/^(margin|padding)(-|$)/.test(declaration.property)
  );
  const spacingDeclarations = Object.entries(spacing)
    .filter(([, spacingValue]) => spacingValue.length > 0)
    .map(([spacingProperty, spacingValue]) => ({ property: spacingProperty, value: spacingValue }));
  return sanitizeTextLineStyleCss(serializeCssDeclarations([...spacingDeclarations, ...preserved]));
}

export function getTextLineStyleLabel(name: string, style: TextLineStyle | undefined): string {
  const label = style?.label.trim() ?? '';
  return label.length > 0 ? label : name;
}

export function replaceTextLineStyleMarkerName(markdown: string, oldName: string, newName: string): string {
  const lines = markdown.split(/\r?\n/);
  let fence: { marker: '`' | '~'; length: number } | null = null;
  return lines
    .map((line) => {
      const fenceLine = parseFenceLine(line);
      if (fence) {
        if (fenceLine && fenceLine.marker === fence.marker && fenceLine.length >= fence.length) {
          fence = null;
        }
        return line;
      }
      if (fenceLine) {
        fence = fenceLine;
        return line;
      }
      return line.replace(new RegExp(`^\\^${escapeRegExp(oldName)}\\^(\\s?)`), `^${newName}^$1`);
    })
    .join('\n');
}

function parseFenceLine(line: string): { marker: '`' | '~'; length: number } | null {
  const match = line.trim().match(/^([`~]{3,})(?:[\w-]+)?\s*$/);
  if (!match) {
    return null;
  }
  const fence = match[1] ?? '';
  const marker = fence[0] as '`' | '~' | undefined;
  return marker ? { marker, length: fence.length } : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCssDeclarations(css: string): Array<{ property: string; value: string }> {
  return css
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const separator = part.indexOf(':');
      if (separator === -1) {
        return null;
      }
      const property = part.slice(0, separator).trim().toLowerCase();
      const value = part.slice(separator + 1).trim();
      return property && value ? { property, value } : null;
    })
    .filter((declaration): declaration is { property: string; value: string } => Boolean(declaration));
}

function serializeCssDeclarations(declarations: Array<{ property: string; value: string }>): string {
  return declarations.map(({ property, value }) => `${property}: ${value};`).join(' ');
}

function expandBoxValue(value: string): [string, string, string, string] {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const top = parts[0] ?? '';
  const right = parts[1] ?? top;
  const bottom = parts[2] ?? top;
  const left = parts[3] ?? right;
  return [top, right, bottom, left];
}
