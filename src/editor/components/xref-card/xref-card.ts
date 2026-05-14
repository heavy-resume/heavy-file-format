import './xref-card.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer, ComponentRenderHelpers } from '../../component-helpers';

export const renderXrefCardEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const hasTarget = normalizeTargetValue(block.schema.xrefTarget).length > 0;
  const targetOptions = helpers.getXrefTargetOptions(block.schema.xrefTargetTagFilter);
  const hasNoFilteredTargets = !hasTarget && block.schema.xrefTargetTagFilter.trim().length > 0 && targetOptions.length === 0;
  const titleOverride = block.schema.xrefTitle.trim().length > 0;
  const detailOverride = block.schema.xrefDetail.trim().length > 0;
  return `
  <div class="xref-card-editor editor-xref-card ${helpers.isXrefTargetValid(block.schema.xrefTarget, block.schema.xrefTargetTagFilter) ? '' : 'is-invalid-target'} ${hasTarget ? '' : 'is-target-empty'}">
    <label class="xref-target-picker">
      <span>Target</span>
      <input
        list="${helpers.escapeAttr(getDatalistId(block.id))}"
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        data-field="block-xref-target"
        value="${helpers.escapeAttr(normalizeTargetValue(block.schema.xrefTarget))}"
        placeholder="${hasNoFilteredTargets ? 'No targets available' : 'Type or pick a target'}"
        ${hasNoFilteredTargets ? 'disabled' : ''}
      />
      <datalist id="${helpers.escapeAttr(getDatalistId(block.id))}">
        ${renderTargetOptions(helpers, targetOptions)}
      </datalist>
      ${hasNoFilteredTargets ? `<p class="xref-target-empty">No ${helpers.escapeHtml(block.schema.xrefTargetTagFilter.trim())} targets available yet.</p>` : ''}
    </label>
    <span class="xref-override-label">Title override</span>
    <strong
      contenteditable="true"
      spellcheck="true"
      data-inline-text="true"
      data-section-key="${helpers.escapeAttr(sectionKey)}"
      data-block-id="${helpers.escapeAttr(block.id)}"
      data-field="block-xref-title"
      ${hasTarget ? '' : 'aria-disabled="true"'}
    >${helpers.escapeHtml(titleOverride ? block.schema.xrefTitle : hasTarget ? getDisplayTitle(block, helpers) : 'Pick a target first')}</strong>
    <span class="xref-override-label">Detail override</span>
    <span
      contenteditable="true"
      spellcheck="true"
      data-inline-text="true"
      data-section-key="${helpers.escapeAttr(sectionKey)}"
      data-block-id="${helpers.escapeAttr(block.id)}"
      data-field="block-xref-detail"
      ${hasTarget ? '' : 'aria-disabled="true"'}
    >${helpers.escapeHtml(detailOverride ? block.schema.xrefDetail : hasTarget ? getDisplayDetail(block, helpers) : '')}</span>
  </div>
`;
};

export const renderXrefCardReader: ComponentReaderRenderer = (_section, block, helpers) =>
  renderXrefCardPreview(
    getDisplayTitle(block, helpers),
    getDisplayDetail(block, helpers),
    block.schema.xrefTarget,
    helpers,
    `reader-xref-card ${helpers.isXrefTargetValid(block.schema.xrefTarget, block.schema.xrefTargetTagFilter) ? '' : 'is-invalid-target'}`
  );

function renderXrefCardPreview(
  title: string,
  detail: string,
  target: string,
  helpers: Pick<ComponentRenderHelpers, 'escapeAttr' | 'escapeHtml' | 'getDocumentComponentCss'>,
  className: string
): string {
  const href = targetToHref(target);
  const externalAttrs = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
  const defaultCss = helpers.getDocumentComponentCss('xref-card').trim();
  const styleAttr = defaultCss ? ` style="${helpers.escapeAttr(defaultCss)}"` : '';
  return `<a class="${helpers.escapeAttr(className)}" href="${helpers.escapeAttr(href)}"${styleAttr}${externalAttrs}>
    <strong>${helpers.escapeHtml(title || 'Untitled')}</strong>
    ${detail.trim().length > 0 ? `<span>${helpers.escapeHtml(detail)}</span>` : ''}
  </a>`;
}

function renderTargetOptions(helpers: ComponentRenderHelpers, options: ReturnType<ComponentRenderHelpers['getXrefTargetOptions']>): string {
  return options
    .map(
      (option) =>
        `<option value="${helpers.escapeAttr(option.value)}" label="${helpers.escapeAttr(option.label)}">${helpers.escapeHtml(option.label)}</option>`
    )
    .join('');
}

function getDisplayTitle(block: Parameters<ComponentEditorRenderer>[1], helpers: ComponentRenderHelpers): string {
  return block.schema.xrefTitle.trim() || getTargetOption(block, helpers)?.title || 'Untitled';
}

function getDisplayDetail(block: Parameters<ComponentEditorRenderer>[1], helpers: ComponentRenderHelpers): string {
  return block.schema.xrefDetail.trim() || getTargetOption(block, helpers)?.detail || '';
}

function getTargetOption(block: Parameters<ComponentEditorRenderer>[1], helpers: ComponentRenderHelpers) {
  const target = normalizeTargetValue(block.schema.xrefTarget);
  return helpers.getXrefTargetOptions(block.schema.xrefTargetTagFilter).find((option) => option.value === target);
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
