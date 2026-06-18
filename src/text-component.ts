import type { ComponentRenderHelpers } from './editor/component-helpers';
import type { TextBlockSchema } from './editor/types';
import { sanitizeInlineCss } from './css-sanitizer';
import { defaultBlockSchema } from './document-factory';
import type { JsonObject } from './hvy/types';

export interface TextComponentPayload {
  text: string;
  schema: TextBlockSchema;
}

export function createDefaultTextComponent(text = ''): TextComponentPayload {
  return {
    text,
    schema: defaultBlockSchema('text') as TextBlockSchema,
  };
}

export function normalizeTextComponent(value: unknown): TextComponentPayload | null {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? createDefaultTextComponent(value) : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = value as JsonObject;
  const text = typeof raw.text === 'string' ? raw.text : '';
  const schema = normalizeTextComponentSchema(raw.schema);
  return { text, schema };
}

export function renderTextComponentElement(value: unknown, helpers: ComponentRenderHelpers): HTMLElement | null {
  const normalized = normalizeTextComponent(value);
  if (!normalized || normalized.text.trim().length === 0) {
    return null;
  }
  const html = helpers.renderTextFragment(normalized.text);
  if (!html) {
    return null;
  }
  const element = document.createElement('div');
  element.className = [
    'hvy-plugin-text-content',
    'reader-block',
    'reader-block-text',
    normalized.schema.align === 'left' ? '' : `align-${normalized.schema.align}`,
    `slot-${normalized.schema.slot}`,
  ].filter(Boolean).join(' ');
  element.dataset.component = 'text';
  element.innerHTML = html;
  element.style.cssText = sanitizeInlineCss(normalized.schema.css);
  if (normalized.schema.align !== 'left') {
    element.style.textAlign = normalized.schema.align;
  }
  return element;
}

function normalizeTextComponentSchema(value: unknown): TextBlockSchema {
  const defaults = createDefaultTextComponent().schema;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaults;
  }
  const raw = value as Partial<TextBlockSchema>;
  return {
    ...defaults,
    ...raw,
    kind: 'text',
    component: 'text',
    align: raw.align === 'center' || raw.align === 'right' ? raw.align : 'left',
    slot: raw.slot === 'left' || raw.slot === 'right' || raw.slot === 'center' ? raw.slot : defaults.slot,
    sortKeys: raw.sortKeys && typeof raw.sortKeys === 'object' && !Array.isArray(raw.sortKeys) ? raw.sortKeys : {},
    groupKeys: raw.groupKeys && typeof raw.groupKeys === 'object' && !Array.isArray(raw.groupKeys) ? raw.groupKeys : {},
  };
}
