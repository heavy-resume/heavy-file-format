import type { JsonObject } from './hvy/types';

export interface HvyPdfStylePreset {
  id: string;
  label: string;
  description?: string;
  documentMeta: JsonObject;
}

export const DEFAULT_PDF_STYLE_PRESETS: HvyPdfStylePreset[] = [
  {
    id: 'plain',
    label: 'Plain',
    description: 'Neutral page settings with simple type and spacing.',
    documentMeta: {
      pdf_page: {
        margins: ['0.75in', '0.75in', '0.75in', '0.75in'],
      },
      theme: {
        colors: {
          '--hvy-bg': '#ffffff',
          '--hvy-text': '#111827',
          '--hvy-surface': '#ffffff',
          '--hvy-border': '#d1d5db',
          '--hvy-link-color': '#1d4ed8',
          '--hvy-table-header': '#f3f4f6',
        },
      },
      section_defaults: {
        css: 'margin: 0 0 0.18in;',
      },
      heading_styles: {
        h1: { css: 'font-size: 18pt; font-weight: 700; line-height: 1.15; margin: 0 0 0.08in;' },
        h2: { css: 'font-size: 13pt; font-weight: 700; line-height: 1.18; margin: 0.18in 0 0.06in;' },
        h3: { css: 'font-size: 11pt; font-weight: 700; line-height: 1.2; margin: 0.12in 0 0.04in;' },
        h4: { css: 'font-size: 10pt; font-weight: 700; line-height: 1.2; margin: 0.08in 0 0.03in;' },
      },
    },
  },
  {
    id: 'compact',
    label: 'Compact',
    description: 'Tighter margins and spacing for dense print documents.',
    documentMeta: {
      pdf_page: {
        margins: ['0.5in', '0.5in', '0.5in', '0.5in'],
      },
      section_defaults: {
        css: 'margin: 0 0 0.1in;',
      },
      heading_styles: {
        h1: { css: 'font-size: 16pt; font-weight: 700; line-height: 1.1; margin: 0 0 0.05in;' },
        h2: { css: 'font-size: 12pt; font-weight: 700; line-height: 1.12; margin: 0.12in 0 0.04in;' },
        h3: { css: 'font-size: 10.5pt; font-weight: 700; line-height: 1.15; margin: 0.08in 0 0.03in;' },
        h4: { css: 'font-size: 9.5pt; font-weight: 700; line-height: 1.15; margin: 0.06in 0 0.02in;' },
      },
    },
  },
  {
    id: 'polished',
    label: 'Polished',
    description: 'Softer surfaces, accent color, and roomier headings.',
    documentMeta: {
      pdf_page: {
        margins: ['0.65in', '0.7in', '0.65in', '0.7in'],
      },
      theme: {
        colors: {
          '--hvy-bg': '#ffffff',
          '--hvy-text': '#172033',
          '--hvy-text-alt': '#334155',
          '--hvy-text-muted': '#64748b',
          '--hvy-surface': '#f8fafc',
          '--hvy-surface-alt': '#eef4f8',
          '--hvy-border': '#cbd5e1',
          '--hvy-accent-1': '#24566f',
          '--hvy-link-color': '#24566f',
          '--hvy-table-header': '#e8eef4',
        },
      },
      section_defaults: {
        css: 'margin: 0 0 0.16in;',
      },
      heading_styles: {
        h1: { css: 'font-size: 20pt; font-weight: 700; line-height: 1.12; color: var(--hvy-accent-1); margin: 0 0 0.08in;' },
        h2: { css: 'font-size: 13pt; font-weight: 700; line-height: 1.15; color: var(--hvy-accent-1); margin: 0.2in 0 0.05in;' },
        h3: { css: 'font-size: 11pt; font-weight: 700; line-height: 1.18; margin: 0.12in 0 0.04in;' },
        h4: { css: 'font-size: 10pt; font-weight: 700; line-height: 1.18; margin: 0.08in 0 0.03in;' },
      },
    },
  },
];

export function normalizePdfStylePresets(presets: readonly HvyPdfStylePreset[] | null | undefined): HvyPdfStylePreset[] {
  const source = presets ?? DEFAULT_PDF_STYLE_PRESETS;
  const seen = new Set<string>();
  return source
    .map((preset) => ({
      id: String(preset.id ?? '').trim(),
      label: String(preset.label ?? '').trim(),
      description: typeof preset.description === 'string' ? preset.description : undefined,
      documentMeta: isJsonObject(preset.documentMeta) ? cloneJsonObject(preset.documentMeta) : {},
    }))
    .filter((preset) => {
      if (!preset.id || !preset.label || seen.has(preset.id) || Object.keys(preset.documentMeta).length === 0) {
        return false;
      }
      seen.add(preset.id);
      return true;
    });
}

export function findPdfStylePreset(
  presets: readonly HvyPdfStylePreset[],
  id: string
): HvyPdfStylePreset | null {
  return presets.find((preset) => preset.id === id) ?? null;
}

export function applyPdfStylePresetToMeta(meta: JsonObject, preset: HvyPdfStylePreset): void {
  mergeJsonObject(meta, preset.documentMeta);
}

function mergeJsonObject(target: JsonObject, patch: JsonObject): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete target[key];
      continue;
    }
    if (isJsonObject(value) && isJsonObject(target[key])) {
      mergeJsonObject(target[key] as JsonObject, value);
      continue;
    }
    target[key] = cloneJsonValue(value);
  }
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return cloneJsonValue(value) as JsonObject;
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }
  if (isJsonObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry)]));
  }
  return value;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
