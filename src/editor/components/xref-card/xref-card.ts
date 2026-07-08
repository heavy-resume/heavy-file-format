import './xref-card.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer, ComponentRenderHelpers } from '../../component-helpers';
import { classifyXrefTarget } from '../../../workspace-links';

export const renderXrefCardEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const targetTagFilter = getEffectiveTargetTagFilter(block, helpers);
  const hasTarget = normalizeTargetValue(block.schema.xrefTarget).length > 0;
  const targetOptions = helpers.getXrefTargetOptions(targetTagFilter);
  const hasNoFilteredTargets = !hasTarget && targetTagFilter.length > 0 && targetOptions.length === 0;
  const titleOverride = block.schema.xrefTitle.trim().length > 0;
  const detailOverride = block.schema.xrefDetail.trim().length > 0;
  return `
  <div class="xref-card-editor editor-xref-card ${helpers.isXrefTargetValid(block.schema.xrefTarget, targetTagFilter) ? '' : 'is-invalid-target'} ${hasTarget ? '' : 'is-target-empty'}">
    <label class="xref-target-picker">
      <span>Target</span>
      <select
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        data-field="block-xref-target"
        ${hasNoFilteredTargets ? 'disabled' : ''}
      >
        ${renderTargetOptions(helpers, targetOptions, normalizeTargetValue(block.schema.xrefTarget))}
      </select>
      ${hasNoFilteredTargets ? `<p class="xref-target-empty">No ${helpers.escapeHtml(targetTagFilter)} targets available yet.</p>` : ''}
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
      data-placeholder="Optional"
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
    `reader-xref-card ${helpers.isXrefTargetValid(block.schema.xrefTarget, getEffectiveTargetTagFilter(block, helpers)) ? '' : 'is-invalid-target'}`
  );

function renderXrefCardPreview(
  title: string,
  detail: string,
  target: string,
  helpers: Pick<ComponentRenderHelpers, 'escapeAttr' | 'escapeHtml' | 'getDocumentComponentCss' | 'isCrossDocumentLinksEnabled'>,
  className: string
): string {
  const classified = classifyXrefTarget(target);
  const defaultCss = helpers.getDocumentComponentCss('xref-card').trim();
  const styleAttr = defaultCss ? ` style="${helpers.escapeAttr(defaultCss)}"` : '';
  const content = `
    <strong>${helpers.escapeHtml(title || 'Untitled')}</strong>
    ${detail.trim().length > 0 ? `<span>${helpers.escapeHtml(detail)}</span>` : ''}`;
  if (classified.kind === 'local') {
    return `<a class="${helpers.escapeAttr(className)}" href="${helpers.escapeAttr(classified.href)}"${styleAttr} data-hvy-link-kind="xref-card" data-hvy-cross-document="false" data-hvy-xref-target="${helpers.escapeAttr(target.trim())}">${content}
  </a>`;
  }
  if (classified.kind === 'workspace' && helpers.isCrossDocumentLinksEnabled?.() === true) {
    return `<a class="${helpers.escapeAttr(className)}" href="${helpers.escapeAttr(classified.href)}"${styleAttr} data-hvy-link-kind="xref-card" data-hvy-cross-document="true" data-hvy-xref-target="${helpers.escapeAttr(target.trim())}">${content}
  </a>`;
  }
  const disabledClass = `${className} is-disabled-target`;
  const invalidClass = classified.kind === 'invalid' ? `${disabledClass} is-invalid-target` : disabledClass;
  return `<div class="${helpers.escapeAttr(invalidClass)}"${styleAttr} role="link" aria-disabled="true" data-hvy-link-kind="xref-card" data-hvy-cross-document="${classified.kind === 'workspace' ? 'true' : 'false'}" data-hvy-xref-target="${helpers.escapeAttr(target.trim())}">${content}
  </div>`;
}

function renderTargetOptions(
  helpers: ComponentRenderHelpers,
  options: ReturnType<ComponentRenderHelpers['getXrefTargetOptions']>,
  selectedTarget: string
): string {
  const optionHtml = options
    .map((option) => {
      const selected = option.value === selectedTarget ? ' selected' : '';
      return `<option value="${helpers.escapeAttr(option.value)}"${selected}>${helpers.escapeHtml(option.title)}</option>`;
    })
    .join('');
  const hasSelectedOption = !selectedTarget || options.some((option) => option.value === selectedTarget);
  const missingSelectedOption = hasSelectedOption
    ? ''
    : `<option value="${helpers.escapeAttr(selectedTarget)}" selected>${helpers.escapeHtml(selectedTarget)}</option>`;
  return `<option value="">Pick a target</option>${missingSelectedOption}${optionHtml}`;
}

function getDisplayTitle(block: Parameters<ComponentEditorRenderer>[1], helpers: ComponentRenderHelpers): string {
  return block.schema.xrefTitle.trim() || getTargetOption(block, helpers)?.title || 'Untitled';
}

function getDisplayDetail(block: Parameters<ComponentEditorRenderer>[1], helpers: ComponentRenderHelpers): string {
  return block.schema.xrefDetail.trim() || getTargetOption(block, helpers)?.detail || '';
}

function getTargetOption(block: Parameters<ComponentEditorRenderer>[1], helpers: ComponentRenderHelpers) {
  const target = normalizeTargetValue(block.schema.xrefTarget);
  return helpers.getXrefTargetOptions(getEffectiveTargetTagFilter(block, helpers)).find((option) => option.value === target);
}

function getEffectiveTargetTagFilter(block: Parameters<ComponentEditorRenderer>[1], helpers: ComponentRenderHelpers): string {
  return helpers.getEffectiveXrefTargetTagFilter?.(block) ?? block.schema.xrefTargetTagFilter.trim();
}

function normalizeTargetValue(target: string): string {
  const trimmed = target.trim();
  return trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
}
