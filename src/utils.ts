import type { VisualBlock } from './editor/types';
import type { VisualDocument } from './types';

export function debugMeasure<T>(label: string, details: Record<string, unknown>, callback: () => T): T {
  const startedAt = performance.now();
  try {
    return callback();
  } finally {
    const elapsed = performance.now() - startedAt;
    console.debug(`[hvy:perf] ${label}`, { elapsedMs: Number(elapsed.toFixed(2)), ...details });
  }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${rand}`;
}

export function detectExtension(filename: string, fallbackContent: string): VisualDocument['extension'] {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.thvy')) {
    return '.thvy';
  }
  if (lower.endsWith('.hvy')) {
    return '.hvy';
  }
  if (lower.endsWith('.md')) {
    return '.md';
  }
  if (/template\s*:\s*true/m.test(fallbackContent)) {
    return '.thvy';
  }
  return '.hvy';
}

export function normalizeFilename(input: string): string {
  if (input.endsWith('.hvy') || input.endsWith('.thvy') || input.endsWith('.md')) {
    return input;
  }
  return `${input}.hvy`;
}

export function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  window.document.body.appendChild(anchor);
  anchor.click();
  window.document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function sanitizeOptionalId(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned;
}

export function renderOption(value: string, selected: string): string {
  return `<option value="${escapeAttr(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(value)}</option>`;
}

export function normalizeInlineText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s*\n+\s*/g, ' ').trim();
}

export function getInlineEditableText(target: HTMLElement): string {
  return normalizeInlineText(target.innerText || target.textContent || '');
}

export function isVisualBlock(value: unknown): value is VisualBlock {
  return !!value && typeof value === 'object' && typeof (value as VisualBlock).id === 'string' && !!(value as VisualBlock).schema;
}

export function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items.slice();
  }
  const next = items.slice();
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}
