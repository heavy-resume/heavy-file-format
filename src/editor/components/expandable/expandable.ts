import './expandable.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import { sanitizeInlineCss } from '../../../css-sanitizer';

export const renderExpandableEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const mobileAdjustment = helpers.isMobileAdjustmentMode();
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
  const stubPreview = stubBlocks
    .slice(0, 2)
    .map((innerBlock) => helpers.renderPassiveEditorBlock(sectionKey, innerBlock))
    .join('');
  const contentPreview = contentBlocks
    .slice(0, 2)
    .map((innerBlock) => helpers.renderPassiveEditorBlock(sectionKey, innerBlock))
    .join('');
  const disabledAttr = mobileAdjustment ? ' disabled' : '';
  const stubMeta = renderExpandablePaneMeta(
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
      <span>Stub CSS</span>
      <textarea
        rows="2"
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        data-field="block-expandable-stub-css"
        placeholder="padding: 0.35rem 0;"
        ${disabledAttr}
      >${helpers.escapeHtml(block.schema.expandableStubCss)}</textarea>
    </label>`
  );
  const contentMeta = renderExpandablePaneMeta(
    'expanded',
    sectionKey,
    block.id,
    helpers,
    `<label class="expandable-pane-css-field">
      <span>Expanded CSS</span>
      <textarea
        rows="2"
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        data-field="block-expandable-content-css"
        placeholder="padding-top: 0.35rem;"
        ${disabledAttr}
      >${helpers.escapeHtml(block.schema.expandableContentCss)}</textarea>
    </label>`
  );
  return `
    <div class="expand-chooser-grid">
      <section class="expandable-part expandable-part-stub${stubOpen ? ' is-open' : ' is-closed'}">
        <div class="expandable-header">
          <button type="button" class="expandable-summary expandable-summary-label" data-action="toggle-expandable-editor-panel" data-section-key="${helpers.escapeAttr(
            sectionKey
          )}" data-block-id="${helpers.escapeAttr(block.id)}" data-expandable-panel="stub" aria-expanded="${stubOpen ? 'true' : 'false'}">
            <span class="expandable-label">Stub</span>
          </button>
          <button type="button" class="expandable-summary expandable-summary-meta-button" data-action="toggle-expandable-editor-panel" data-section-key="${helpers.escapeAttr(
            sectionKey
          )}" data-block-id="${helpers.escapeAttr(block.id)}" data-expandable-panel="stub" aria-expanded="${stubOpen ? 'true' : 'false'}">
            <span class="expandable-summary-meta">${helpers.escapeHtml(String(stubCount))} component${stubCount === 1 ? '' : 's'}</span>
          </button>
        </div>
        ${
          stubOpen
            ? `<div class="expandable-part-body">
          ${stubMeta}
          <div class="container-inner-blocks">
            ${stubBlocks.map((innerBlock) => helpers.renderEditorBlock(sectionKey, innerBlock, false)).join('')}
          </div>
          ${mobileAdjustment ? '' : `<article class="ghost-section-card add-ghost compact-add-component-ghost">
                  ${helpers.renderAddComponentPicker({
                    id: stubAddKey,
                    action: 'add-expandable-stub-block',
                    sectionKey,
                    blockId: block.id,
                    label: 'Expandable stub component type',
                  })}
                </article>`}
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
          <button type="button" class="expandable-summary expandable-summary-meta-button" data-action="toggle-expandable-editor-panel" data-section-key="${helpers.escapeAttr(
            sectionKey
          )}" data-block-id="${helpers.escapeAttr(block.id)}" data-expandable-panel="expanded" aria-expanded="${expandedOpen ? 'true' : 'false'}">
            <span class="expandable-summary-meta">${helpers.escapeHtml(String(contentCount))} component${contentCount === 1 ? '' : 's'}</span>
          </button>
        </div>
        ${
          expandedOpen
            ? `<div class="expandable-part-body">
          ${contentMeta}
          <div class="container-inner-blocks">
            ${contentBlocks.map((innerBlock) => helpers.renderEditorBlock(sectionKey, innerBlock, false)).join('')}
          </div>
          ${mobileAdjustment ? '' : `<article class="ghost-section-card add-ghost compact-add-component-ghost">
                  ${helpers.renderAddComponentPicker({
                    id: contentAddKey,
                    action: 'add-expandable-content-block',
                    sectionKey,
                    blockId: block.id,
                    label: 'Expandable content component type',
                  })}
                </article>`}
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

function renderExpandablePaneMeta(
  pane: 'stub' | 'expanded',
  sectionKey: string,
  blockId: string,
  helpers: Parameters<ComponentEditorRenderer>[2],
  body: string
): string {
  return `<details class="expandable-pane-meta">
    <summary>
      <span>${pane === 'stub' ? 'Stub' : 'Expanded'} meta</span>
      <span class="expandable-pane-meta-id">${helpers.escapeHtml(blockId)}</span>
    </summary>
    <div class="expandable-pane-meta-body" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(blockId)}">
      ${body}
    </div>
  </details>`;
}

export const renderExpandableReader: ComponentReaderRenderer = (section, block, helpers) => {
  const stubHtml = block.schema.expandableStubBlocks.children.map((innerBlock) => helpers.renderReaderBlock(section, innerBlock)).join('');
  const contentHtml = block.schema.expandableContentBlocks.children.map((innerBlock) => helpers.renderReaderBlock(section, innerBlock)).join('');
  const expanded = block.schema.expandableExpanded;
  const alwaysShowStub = block.schema.expandableAlwaysShowStub;
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
  const body = expanded
    ? alwaysShowStub
      ? `${stubToggle}<div class="expandable-reader-pane expandable-reader-pane-expanded"><div class="expand-content" style="${contentPaneStyle}" ${contentToggleAttrs}>${contentHtml}</div></div>`
      : `<div class="expandable-reader-pane expandable-reader-pane-expanded"><div class="expand-content" style="${contentPaneStyle}" ${contentToggleAttrs}>${contentHtml}</div></div>`
    : stubToggle;
  return `<div class="expandable-reader is-interactive" data-expandable-id="${helpers.escapeAttr(block.id)}">
    <div class="expandable-reader-body">${body}</div>
  </div>`;
};
