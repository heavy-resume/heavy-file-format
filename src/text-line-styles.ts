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
