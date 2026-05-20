import type { JsonObject } from '../hvy/types';
import type { VisualBlock, VisualSection } from './types';
import { plusIcon } from '../icons';

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
  return sections.some((section) =>
    section.blocks.some((block) => blockContainsTemplateToken(block, token))
    || section.children.some((child) => hasTemplateFieldBlock(field, [child]))
  );
}

function blockContainsTemplateToken(block: VisualBlock, token: string): boolean {
  if (block.text.includes(token)) {
    return true;
  }
  if (schemaContainsTemplateToken(block.schema as unknown as JsonObject, token)) {
    return true;
  }
  return [
    ...(block.schema.containerBlocks ?? []),
    ...(block.schema.componentListBlocks ?? []),
    ...(block.schema.expandableStubBlocks?.children ?? []),
    ...(block.schema.expandableContentBlocks?.children ?? []),
    ...(block.schema.gridItems ?? []).map((item) => item.block),
  ].some((child) => blockContainsTemplateToken(child, token));
}

function schemaContainsTemplateToken(value: unknown, token: string): boolean {
  if (typeof value === 'string') {
    return value.includes(token);
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => schemaContainsTemplateToken(item, token));
  }
  return Object.entries(value).some(([, nested]) => schemaContainsTemplateToken(nested, token));
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
      <div class="ghost-section-card template-ghost" data-action="add-template-field" data-template-field="${helpers.escapeAttr(field)}">
        <div class="ghost-plus-big">${plusIcon()}</div>
        <div class="ghost-label">Add Template Field: ${helpers.escapeHtml(field)}</div>
      </div>
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
