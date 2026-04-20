import type { ComponentEditorRenderer, ComponentReaderRenderer, ComponentRenderHelpers } from '../component-helpers';

export const renderXrefCardEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => `
  <div class="xref-card-editor editor-xref-card ${helpers.isXrefTargetValid(block.schema.xrefTarget) ? '' : 'is-invalid-target'}">
    <strong
      contenteditable="true"
      data-inline-text="true"
      data-section-key="${helpers.escapeAttr(sectionKey)}"
      data-block-id="${helpers.escapeAttr(block.id)}"
      data-field="block-xref-title"
    >${helpers.escapeHtml(block.schema.xrefTitle || 'Untitled')}</strong>
    <span
      contenteditable="true"
      data-inline-text="true"
      data-section-key="${helpers.escapeAttr(sectionKey)}"
      data-block-id="${helpers.escapeAttr(block.id)}"
      data-field="block-xref-detail"
    >${helpers.escapeHtml(block.schema.xrefDetail || 'Add detail')}</span>
    <label class="xref-target-picker">
      <span>Target</span>
      <input
        list="${helpers.escapeAttr(getDatalistId(block.id))}"
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        data-field="block-xref-target"
        value="${helpers.escapeAttr(normalizeTargetValue(block.schema.xrefTarget))}"
        placeholder="Start typing a target"
      />
      <datalist id="${helpers.escapeAttr(getDatalistId(block.id))}">
        ${renderTargetOptions(helpers)}
      </datalist>
    </label>
  </div>
`;

export const renderXrefCardReader: ComponentReaderRenderer = (_section, block, helpers) =>
  renderXrefCardPreview(
    block.schema.xrefTitle,
    block.schema.xrefDetail,
    block.schema.xrefTarget,
    helpers,
    `reader-xref-card ${helpers.isXrefTargetValid(block.schema.xrefTarget) ? '' : 'is-invalid-target'}`
  );

function renderXrefCardPreview(
  title: string,
  detail: string,
  target: string,
  helpers: Pick<ComponentRenderHelpers, 'escapeAttr' | 'escapeHtml'>,
  className: string
): string {
  const href = targetToHref(target);
  const externalAttrs = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a class="${helpers.escapeAttr(className)}" href="${helpers.escapeAttr(href)}"${externalAttrs}>
    <strong>${helpers.escapeHtml(title || 'Untitled')}</strong>
    ${detail.trim().length > 0 ? `<span>${helpers.escapeHtml(detail)}</span>` : ''}
  </a>`;
}

function renderTargetOptions(helpers: ComponentRenderHelpers): string {
  return helpers
    .getXrefTargetOptions()
    .map(
      (option) =>
        `<option value="${helpers.escapeAttr(option.value)}" label="${helpers.escapeAttr(option.label)}">${helpers.escapeHtml(option.label)}</option>`
    )
    .join('');
}

function getDatalistId(blockId: string): string {
  return `xref-targets-${blockId}`;
}

function normalizeTargetValue(target: string): string {
  const trimmed = target.trim();
  return trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
}

function targetToHref(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) {
    return '#';
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('#')) {
    return trimmed;
  }
  return `#${trimmed}`;
}
