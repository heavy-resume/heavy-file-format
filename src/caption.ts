import type { ComponentRenderHelpers } from './editor/component-helpers';
import type { TextBlockSchema, TextCaptionPayload, VisualBlock } from './editor/types';
import type { JsonObject } from './hvy/types';

export type CaptionTarget =
  | { kind: 'image'; sectionKey: string; blockId: string }
  | { kind: 'plugin-config'; pluginId: string; sectionKey: string; blockId: string; configKey: string; title?: string };

export interface CaptionTextModalState {
  target: CaptionTarget;
  title: string;
  onChange?: (next: TextCaptionPayload | null) => void;
}

export function createDefaultTextCaption(text = ''): TextCaptionPayload {
  const schema: TextBlockSchema = {
    kind: 'text',
    id: '',
    component: 'text',
    editorOnly: false,
    lock: false,
    align: 'center',
    slot: 'center',
    css: 'margin: 0.5rem 0;',
    sortKeys: {},
    groupKeys: {},
    tags: '',
    description: '',
    hideIfYes: '',
    visibleScript: '',
    placeholder: '',
    fillIn: false,
    showCopy: false,
    metaOpen: false,
    xrefTitle: '',
    xrefDetail: '',
  };
  return { text, schema };
}

export function normalizeTextCaption(value: unknown): TextCaptionPayload | null {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? createDefaultTextCaption(value) : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = value as JsonObject;
  const text = typeof raw.text === 'string' ? raw.text : '';
  const schema = normalizeCaptionSchema(raw.schema);
  return { text, schema };
}

export function serializeTextCaption(caption: unknown): JsonObject | null {
  const normalized = normalizeTextCaption(caption);
  if (!normalized || normalized.text.trim().length === 0) {
    return null;
  }
  return {
    text: normalized.text,
    schema: normalized.schema,
  };
}

export function getTextCaptionMarkdown(caption: unknown): string {
  return normalizeTextCaption(caption)?.text ?? '';
}

export function renderTextCaptionHtml(caption: unknown, helpers: ComponentRenderHelpers): string {
  const normalized = normalizeTextCaption(caption);
  if (!normalized || normalized.text.trim().length === 0) {
    return '';
  }
  const block = createTextCaptionBlock(normalized);
  return helpers.renderComponentFragment('text', normalized.text, block);
}

export function renderTextCaptionElement(caption: unknown, helpers: ComponentRenderHelpers): HTMLElement | null {
  const normalized = normalizeTextCaption(caption);
  const html = renderTextCaptionHtml(normalized, helpers);
  if (!html) {
    return null;
  }
  const element = document.createElement('span');
  element.className = 'hvy-text-caption-content';
  element.innerHTML = html;
  const align = normalized?.schema.align ?? 'center';
  element.style.textAlign = align;
  return element;
}

export function createTextCaptionBlock(caption: TextCaptionPayload): VisualBlock {
  return {
    id: 'caption',
    text: caption.text,
    schema: {
      ...caption.schema,
      kind: 'text',
      component: 'text',
    } as VisualBlock['schema'],
    schemaMode: false,
  };
}

export function updateTextCaptionText(caption: unknown, text: string): TextCaptionPayload | null {
  const normalized = normalizeTextCaption(caption);
  const next = normalized ? cloneTextCaption(normalized) : createDefaultTextCaption();
  next.text = text;
  return next.text.trim().length === 0 ? null : next;
}

export function updateTextCaptionAlign(caption: unknown, align: TextBlockSchema['align']): TextCaptionPayload {
  const normalized = normalizeTextCaption(caption);
  const next = normalized ? cloneTextCaption(normalized) : createDefaultTextCaption();
  next.schema.align = align;
  return next;
}

export function cloneTextCaption(caption: TextCaptionPayload): TextCaptionPayload {
  return {
    text: caption.text,
    schema: {
      ...caption.schema,
      sortKeys: { ...caption.schema.sortKeys },
      groupKeys: { ...caption.schema.groupKeys },
    },
  };
}

function normalizeCaptionSchema(value: unknown): TextBlockSchema {
  const defaults = createDefaultTextCaption().schema;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaults;
  }
  const raw = value as Partial<TextBlockSchema>;
  return {
    ...defaults,
    ...raw,
    kind: 'text',
    component: 'text',
    align: raw.align === 'left' || raw.align === 'right' || raw.align === 'center' ? raw.align : 'center',
    sortKeys: raw.sortKeys && typeof raw.sortKeys === 'object' && !Array.isArray(raw.sortKeys) ? raw.sortKeys : {},
    groupKeys: raw.groupKeys && typeof raw.groupKeys === 'object' && !Array.isArray(raw.groupKeys) ? raw.groupKeys : {},
  };
}
