import type { ComponentEditorRenderer, ComponentReaderRenderer, ComponentRenderHelpers } from '../component-helpers';

export const renderXrefCardEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => `
  <div class="xref-card-editor">
    <label>
      <span>Title</span>
      <input data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
        block.id
      )}" data-field="block-xref-title" value="${helpers.escapeAttr(block.schema.xrefTitle)}" />
    </label>
    <label>
      <span>Detail</span>
      <input data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
        block.id
      )}" data-field="block-xref-detail" value="${helpers.escapeAttr(block.schema.xrefDetail)}" />
    </label>
    <label>
      <span>Target</span>
      <input data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
        block.id
      )}" data-field="block-xref-target" value="${helpers.escapeAttr(block.schema.xrefTarget)}" placeholder="#section-id or https://..." />
    </label>
    ${renderXrefCardPreview(block.schema.xrefTitle, block.schema.xrefDetail, block.schema.xrefTarget, helpers, 'editor-xref-card')}
  </div>
`;

export const renderXrefCardReader: ComponentReaderRenderer = (_section, block, helpers) =>
  renderXrefCardPreview(block.schema.xrefTitle, block.schema.xrefDetail, block.schema.xrefTarget, helpers, 'reader-xref-card');

function renderXrefCardPreview(
  title: string,
  detail: string,
  target: string,
  helpers: Pick<ComponentRenderHelpers, 'escapeAttr' | 'escapeHtml'>,
  className: string
): string {
  const href = target.trim() || '#';
  const externalAttrs = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a class="${helpers.escapeAttr(className)}" href="${helpers.escapeAttr(href)}"${externalAttrs}>
    <strong>${helpers.escapeHtml(title || 'Untitled')}</strong>
    ${detail.trim().length > 0 ? `<span>${helpers.escapeHtml(detail)}</span>` : ''}
  </a>`;
}
