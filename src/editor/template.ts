import type { JsonObject } from '../hvy/types';
import type { VisualSection } from './types';

interface TemplateRenderHelpers {
  escapeAttr: (value: string) => string;
  escapeHtml: (value: string) => string;
}

export function getTemplateFields(meta: JsonObject): string[] {
  if (meta.template !== true) {
    return [];
  }
  const schema = meta.schema;
  if (!schema || typeof schema !== 'object') {
    return [];
  }
  const properties = (schema as JsonObject).properties;
  if (!properties || typeof properties !== 'object') {
    return [];
  }
  return Object.keys(properties as JsonObject);
}

export function hasTemplateFieldBlock(field: string, sections: VisualSection[]): boolean {
  const token = `{{${field}}}`;
  return sections.some((section) => section.blocks.some((block) => block.text.includes(token)));
}

export function renderTemplateGhosts(
  fields: string[],
  sections: VisualSection[],
  helpers: TemplateRenderHelpers
): string {
  if (fields.length === 0) {
    return '';
  }

  return fields
    .filter((field) => !hasTemplateFieldBlock(field, sections))
    .map(
      (field) => `
      <article class="ghost-section-card template-ghost" data-action="add-template-field" data-template-field="${helpers.escapeAttr(field)}">
        <div class="ghost-plus-big"><span>+</span></div>
        <div class="ghost-label">Add Template Field: ${helpers.escapeHtml(field)}</div>
      </article>
    `
    )
    .join('');
}

export function renderTemplatePanel(
  fields: string[],
  templateValues: Record<string, string>,
  helpers: TemplateRenderHelpers
): string {
  if (fields.length === 0) {
    return '';
  }

  return `
    <section class="template-panel">
      <div class="template-title">Template Fields</div>
      <div class="template-grid">
        ${fields
          .map(
            (field) => `<div class="template-item">
              <label>
                <span>${helpers.escapeHtml(field)}</span>
                <input data-field="template-value" data-template-field="${helpers.escapeAttr(field)}" value="${helpers.escapeAttr(
                  templateValues[field] ?? ''
                )}" placeholder="Fill value or leave blank" />
              </label>
            </div>`
          )
          .join('')}
      </div>
    </section>
  `;
}
