import './expandable.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import type { VisualBlock } from '../../types';
import { sanitizeInlineCss } from '../../../css-sanitizer';

export const renderExpandableEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const mobileAdjustment = helpers.isMobileAdjustmentMode();
  const pdfDocument = helpers.isPdfDocument?.() === true;
  const advanced = helpers.isAdvancedEditorMode();
  const stubAddKey = `expandable-stub:${sectionKey}:${block.id}`;
  const contentAddKey = `expandable-content:${sectionKey}:${block.id}`;
  const stub = block.schema.expandableStubBlocks;
  const content = block.schema.expandableContentBlocks;
  const stubBlocks = stub.children;
  const contentBlocks = content.children;
  const stubCount = stubBlocks.length;
  const contentCount = contentBlocks.length;
  const stubOpen = helpers.isExpandableEditorPanelOpen(sectionKey, block.id, 'stub', false);
  const expandedOpen = helpers.isExpandableEditorPanelOpen(sectionKey, block.id, 'expanded', false);
  const stubPlacementTargets = renderExpandablePlacementBlockList(sectionKey, block.id, 'expandable-stub', stubBlocks, helpers, block.schema.lock || stub.lock || pdfDocument);
  const contentPlacementTargets = renderExpandablePlacementBlockList(sectionKey, block.id, 'expandable-content', contentBlocks, helpers, block.schema.lock || content.lock || pdfDocument);
  const stubPlacementMode = stubPlacementTargets.includes('component-placement-target');
  const contentPlacementMode = contentPlacementTargets.includes('component-placement-target');
  const stubPreview = stubBlocks
    .slice(0, 2)
    .map((innerBlock) => helpers.renderPassiveEditorBlock(sectionKey, innerBlock))
    .join('');
  const contentPreview = contentBlocks
    .slice(0, 2)
    .map((innerBlock) => helpers.renderPassiveEditorBlock(sectionKey, innerBlock))
    .join('');
  const disabledAttr = mobileAdjustment ? ' disabled' : '';
  const stubMeta = advanced ? renderExpandablePaneMeta(
    'stub',
    sectionKey,
    block.id,
    helpers,
    `<label class="expandable-inline-toggle">
      <input type="checkbox" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
        block.id
      )}" data-field="block-expandable-always" ${block.schema.expandableAlwaysShowStub ? 'checked' : ''}${disabledAttr} />
      <span>Always show</span>
    </label>
    <label class="expandable-pane-css-field">
      <span class="description-label-with-action">Description${
        block.schema.expandableStubDescription.trim()
          ? ''
          : ` <button type="button" class="ghost inline-generate-description" data-action="generate-expandable-pane-description" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" data-expandable-pane="stub">Generate</button>`
      }</span>
      <textarea
        rows="2"
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        data-field="block-expandable-stub-description"
        ${disabledAttr}
      >${helpers.escapeHtml(block.schema.expandableStubDescription)}</textarea>
    </label>
    <label class="expandable-pane-css-field">
      <span>CSS</span>
      <textarea
        rows="2"
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        data-field="block-expandable-stub-css"
        placeholder="padding: 0.35rem 0;"
        ${disabledAttr}
      >${helpers.escapeHtml(block.schema.expandableStubCss)}</textarea>
    </label>`
  ) : '';
  const contentMeta = advanced ? renderExpandablePaneMeta(
    'expanded',
    sectionKey,
    block.id,
    helpers,
    `<label class="expandable-pane-css-field">
      <span class="description-label-with-action">Description${
        block.schema.expandableContentDescription.trim()
          ? ''
          : ` <button type="button" class="ghost inline-generate-description" data-action="generate-expandable-pane-description" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" data-expandable-pane="expanded">Generate</button>`
      }</span>
      <textarea
        rows="2"
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        data-field="block-expandable-content-description"
        ${disabledAttr}
      >${helpers.escapeHtml(block.schema.expandableContentDescription)}</textarea>
    </label>
    <label class="expandable-pane-css-field">
      <span>CSS</span>
      <textarea
        rows="2"
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        data-field="block-expandable-content-css"
        placeholder="padding-top: 0.35rem;"
        ${disabledAttr}
      >${helpers.escapeHtml(block.schema.expandableContentCss)}</textarea>
    </label>`
  ) : '';
  return `
    <div class="expand-chooser-grid">
      <section class="expandable-part expandable-part-stub${stubOpen ? ' is-open' : ' is-closed'}">
        <div class="expandable-header">
          <button type="button" class="expandable-summary expandable-summary-label" data-action="toggle-expandable-editor-panel" data-section-key="${helpers.escapeAttr(
            sectionKey
          )}" data-block-id="${helpers.escapeAttr(block.id)}" data-expandable-panel="stub" aria-expanded="${stubOpen ? 'true' : 'false'}">
            <span class="expandable-label">Stub</span>
          </button>
          ${stubMeta}
          <button type="button" class="expandable-summary expandable-summary-meta-button" data-action="toggle-expandable-editor-panel" data-section-key="${helpers.escapeAttr(
            sectionKey
          )}" data-block-id="${helpers.escapeAttr(block.id)}" data-expandable-panel="stub" aria-expanded="${stubOpen ? 'true' : 'false'}">
            <span class="expandable-summary-meta">${helpers.escapeHtml(String(stubCount))} component${stubCount === 1 ? '' : 's'}</span>
          </button>
        </div>
        ${
          stubOpen
            ? `<div class="expandable-part-body">
          <div class="container-inner-blocks">
            ${stubPlacementTargets}
          </div>
          ${mobileAdjustment || pdfDocument || stubPlacementMode ? '' : `<div class="ghost-section-card add-ghost compact-add-component-ghost">
                  ${helpers.renderAddComponentPicker({
                    id: stubAddKey,
                    action: 'add-expandable-stub-block',
                    sectionKey,
                    blockId: block.id,
                    label: 'Expandable stub component type',
                  })}
                </div>`}
        </div>`
            : `<button type="button" class="expandable-collapsed-preview expandable-collapsed-preview-button" data-action="toggle-expandable-editor-panel" data-section-key="${helpers.escapeAttr(
                sectionKey
              )}" data-block-id="${helpers.escapeAttr(block.id)}" data-expandable-panel="stub" aria-expanded="false">
                 ${stubPreview || '<div class="expandable-collapsed-empty">No stub content yet.</div>'}
               </button>`
        }
      </section>
      <section class="expandable-part expandable-part-expanded${expandedOpen ? ' is-open' : ' is-closed'}">
        <div class="expandable-header">
          <button type="button" class="expandable-summary expandable-summary-label" data-action="toggle-expandable-editor-panel" data-section-key="${helpers.escapeAttr(
            sectionKey
          )}" data-block-id="${helpers.escapeAttr(block.id)}" data-expandable-panel="expanded" aria-expanded="${expandedOpen ? 'true' : 'false'}">
            <span class="expandable-label">Expanded</span>
          </button>
          ${contentMeta}
          <button type="button" class="expandable-summary expandable-summary-meta-button" data-action="toggle-expandable-editor-panel" data-section-key="${helpers.escapeAttr(
            sectionKey
          )}" data-block-id="${helpers.escapeAttr(block.id)}" data-expandable-panel="expanded" aria-expanded="${expandedOpen ? 'true' : 'false'}">
            <span class="expandable-summary-meta">${helpers.escapeHtml(String(contentCount))} component${contentCount === 1 ? '' : 's'}</span>
          </button>
        </div>
        ${
          expandedOpen
            ? `<div class="expandable-part-body">
          <div class="container-inner-blocks">
            ${contentPlacementTargets}
          </div>
          ${mobileAdjustment || pdfDocument || contentPlacementMode ? '' : `<div class="ghost-section-card add-ghost compact-add-component-ghost">
                  ${helpers.renderAddComponentPicker({
                    id: contentAddKey,
                    action: 'add-expandable-content-block',
                    sectionKey,
                    blockId: block.id,
                    label: 'Expandable content component type',
                  })}
                </div>`}
        </div>`
            : `<button type="button" class="expandable-collapsed-preview expandable-collapsed-preview-button" data-action="toggle-expandable-editor-panel" data-section-key="${helpers.escapeAttr(
                sectionKey
              )}" data-block-id="${helpers.escapeAttr(block.id)}" data-expandable-panel="expanded" aria-expanded="false">
                 ${contentPreview || '<div class="expandable-collapsed-empty">No expanded content yet.</div>'}
               </button>`
        }
      </section>
    </div>
  `;
};

function renderExpandablePlacementBlockList(
  sectionKey: string,
  parentBlockId: string,
  container: 'expandable-stub' | 'expandable-content',
  blocks: VisualBlock[],
  helpers: Parameters<ComponentEditorRenderer>[2],
  locked: boolean
): string {
  const output: string[] = [];
  if (!locked && blocks.length > 0) {
    output.push(helpers.renderComponentPlacementTarget({
      container,
      sectionKey,
      parentBlockId,
      placement: 'before',
      targetBlockId: blocks[0]?.id,
    }));
  }
  for (const innerBlock of blocks) {
    output.push(helpers.renderEditorBlock(sectionKey, innerBlock, locked));
    if (!locked) {
      output.push(helpers.renderComponentPlacementTarget({
        container,
        sectionKey,
        parentBlockId,
        placement: 'after',
        targetBlockId: innerBlock.id,
      }));
    }
  }
  if (!locked && blocks.length === 0) {
    output.push(helpers.renderComponentPlacementTarget({
      container,
      sectionKey,
      parentBlockId,
      placement: 'end',
    }));
  }
  return output.join('');
}

function renderExpandablePaneMeta(
  pane: 'stub' | 'expanded',
  sectionKey: string,
  blockId: string,
  helpers: Parameters<ComponentEditorRenderer>[2],
  body: string
): string {
  return `<details class="expandable-pane-meta">
    <summary class="expandable-pane-meta-button" aria-label="${pane === 'stub' ? 'Stub Meta' : 'Expanded Meta'}">${pane === 'stub' ? 'Stub Meta' : 'Expanded Meta'}</summary>
    <div class="expandable-pane-meta-body" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(blockId)}">
      <div class="expandable-pane-meta-title">${pane === 'stub' ? 'Stub Meta' : 'Expanded Meta'}</div>
      ${body}
    </div>
  </details>`;
}

export const renderExpandableReader: ComponentReaderRenderer = (section, block, helpers) => {
  const stubHtml = helpers.renderReaderBlocks(section, block.schema.expandableStubBlocks.children);
  const contentHtml = helpers.renderReaderBlocks(section, block.schema.expandableContentBlocks.children);
  if (!stubHtml.trim() && !contentHtml.trim()) {
    return '';
  }
  const expanded = block.schema.expandableExpanded;
  const alwaysShowStub = block.schema.expandableAlwaysShowStub;
  const hasStubContent = stubHtml.trim().length > 0;
  const stubPaneStyle = helpers.escapeAttr(sanitizeInlineCss(block.schema.expandableStubCss));
  const contentPaneStyle = helpers.escapeAttr(sanitizeInlineCss(block.schema.expandableContentCss));
  const toggleAttrs = `data-reader-action="toggle-expandable" data-section-key="${helpers.escapeAttr(section.key)}" data-block-id="${helpers.escapeAttr(
    block.id
  )}" aria-expanded="${expanded ? 'true' : 'false'}"`;
  const stubToggle = `<div class="expandable-reader-pane expandable-reader-pane-stub">
    <div class="expand-stub-toggle" style="${stubPaneStyle}" ${toggleAttrs}>
      <div class="expand-stub">${stubHtml}</div>
    </div>
  </div>`;
  const contentToggleAttrs = `data-reader-action="toggle-expandable" data-expandable-content="true" data-section-key="${helpers.escapeAttr(section.key)}" data-block-id="${helpers.escapeAttr(block.id)}" aria-expanded="true"`;
  const collapsedContentPreviewAttrs = `data-reader-action="toggle-expandable" data-expandable-content="true" data-section-key="${helpers.escapeAttr(section.key)}" data-block-id="${helpers.escapeAttr(block.id)}" aria-expanded="false"`;
  const contentPane = `<div class="expandable-reader-pane expandable-reader-pane-expanded"><div class="expand-content" style="${contentPaneStyle}" ${contentToggleAttrs}>${contentHtml}</div></div>`;
  const collapsedContentPreview = `<div class="expandable-reader-pane expandable-reader-pane-expanded expandable-reader-pane-content-preview"><div class="expand-content" style="${contentPaneStyle}" ${collapsedContentPreviewAttrs}>${contentHtml}</div></div>`;
  const body = expanded
    ? alwaysShowStub && hasStubContent
      ? `${stubToggle}${contentPane}`
      : contentPane
    : hasStubContent
      ? stubToggle
      : collapsedContentPreview;
  const className = [
    'expandable-reader',
    'is-interactive',
    expanded ? 'is-expanded' : 'is-collapsed',
    hasStubContent ? '' : 'has-empty-stub',
  ]
    .filter(Boolean)
    .join(' ');
  return `<div class="${helpers.escapeAttr(className)}" data-expandable-id="${helpers.escapeAttr(block.id)}">
    <div class="expandable-reader-body">${body}</div>
  </div>`;
};
